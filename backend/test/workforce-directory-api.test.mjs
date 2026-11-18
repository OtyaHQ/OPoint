import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const staffDirectoryRows = [{
  membership_id: "staff-1",
  display_name: "Synthetic employee",
  email: "employee@example.invalid",
  role_key: "AGENT",
  membership_status: "ACTIVE",
  branch_id: "branch-1",
  branch_name: "Mbirizi",
  employee_profile_id: "employee-1",
  employee_number: "EMP-001",
  employment_type: "PERMANENT",
  employment_status: "ACTIVE",
  hire_date: "2026-01-01",
  end_date: null,
  position_title: "Agency Teller",
  department_name: "Operations",
}];

const branchRows = [
  { id: "branch-1", branch_code: "MBR-001", name: "Mbirizi", status: "ACTIVE", is_primary: 1 },
  { id: "branch-2", branch_code: "MSK-001", name: "Masaka", status: "ACTIVE", is_primary: 0 },
];

class MemoryD1 {
  constructor(roleKey, branchId = null) {
    this.roleKey = roleKey;
    this.branchId = branchId;
    this.calls = [];
  }

  prepare(sql) {
    const database = this;
    const statement = {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        database.calls.push({ kind: "first", sql: this.sql, values: [...this.values] });
        if (this.sql.includes("FROM staff_memberships sm JOIN companies c")) {
          return this.values[0] === "identity-1" && this.values[1] === "company-1"
            ? {
                membership_id: "membership-1",
                company_id: "company-1",
                branch_id: database.branchId,
                display_name: "Synthetic user",
                email: "user@example.invalid",
                role_key: database.roleKey,
                status: "ACTIVE",
                company_name: "Synthetic Otya company",
              }
            : null;
        }
        if (this.sql.includes("FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE'")) {
          return this.values[0] === "company-1" && branchRows.some(row => row.id === this.values[1])
            ? { id: this.values[1] }
            : null;
        }
        return null;
      },
      async all() {
        database.calls.push({ kind: "all", sql: this.sql, values: [...this.values] });
        if (this.sql.includes("FROM staff_memberships sm LEFT JOIN employee_profiles")) {
          return { results: staffDirectoryRows };
        }
        if (this.sql.includes("FROM branches b WHERE b.company_id=?1")) {
          const [companyId, memberBranchId, membershipId] = this.values;
          assert.equal(companyId, "company-1");
          assert.equal(membershipId, "membership-1");
          return { results: memberBranchId ? branchRows.filter(row => row.id === memberBranchId) : [] };
        }
        if (this.sql.includes("FROM branches WHERE company_id=?1 AND status='ACTIVE'")) {
          assert.equal(this.values[0], "company-1");
          return { results: branchRows };
        }
        return { results: [] };
      },
      async run() {
        throw new Error("Unexpected write in read-only workforce API test");
      },
    };
    return statement;
  }

  async batch() {
    throw new Error("Unexpected batch in read-only workforce API test");
  }
}

function makeEnv(roleKey, branchId = null) {
  return {
    DB: new MemoryD1(roleKey, branchId),
    OTYA_ID: {
      async fetch() {
        return Response.json({
          ok: true,
          user_id: "identity-1",
          email: "user@example.invalid",
        });
      },
    },
  };
}

function apiRequest(path) {
  return new Request("https://opoint.internal" + path, {
    method: "GET",
    headers: { authorization: "Bearer synthetic-token" },
  });
}

test("Owner can read a company-scoped workforce directory with limited employment metadata", async () => {
  const env = makeEnv("OWNER");
  const response = await worker.fetch(
    apiRequest("/v1/staff?companyId=company-1"),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data[0].membership_id, "staff-1");
  assert.equal(body.data[0].employee_number, "EMP-001");

  const query = env.DB.calls.find(call => call.kind === "all")?.sql || "";
  assert.match(query, /sm\.company_id=\?1/);
  assert.doesNotMatch(query, /national_id|passport|document_url|kyc_document|msisdn|sim\.msisdn/i);
});

test("Manager and operator memberships cannot read the company workforce directory", async () => {
  for (const role of ["MANAGER", "AGENT"]) {
    const env = makeEnv(role);
    const response = await worker.fetch(
      apiRequest("/v1/staff?companyId=company-1"),
      env,
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "staff_directory_forbidden");
    assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 0);
  }
});

test("A branch-assigned employee sees only their default branch in branch discovery", async () => {
  const env = makeEnv("AGENT", "branch-1");
  const response = await worker.fetch(
    apiRequest("/v1/branches?companyId=company-1"),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.map(row => row.id), ["branch-1"]);
  const query = env.DB.calls.find(call => call.kind === "all")?.sql || "";
  assert.match(query, /staff_work_assignments/);
  assert.match(query, /staff_membership_id=\?3/);
});

test("An Owner can discover all active branches within their company", async () => {
  const env = makeEnv("OWNER", "branch-1");
  const response = await worker.fetch(
    apiRequest("/v1/branches?companyId=company-1"),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.map(row => row.id), ["branch-1", "branch-2"]);
});

test("Workforce directory branch filters reject unknown company branches", async () => {
  const env = makeEnv("OWNER");
  const response = await worker.fetch(
    apiRequest("/v1/staff?companyId=company-1&branchId=missing-branch"),
    env,
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "active_branch_required");
  assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 0);
});

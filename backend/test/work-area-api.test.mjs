import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

class MemoryD1 {
  constructor({ membership, assignments = [], activeBranches = ["branch-1"] }) {
    this.membership = membership;
    this.assignments = assignments;
    this.activeBranches = new Set(activeBranches);
  }

  prepare(sql) {
    const statement = {
      sql,
      values: [],
      bind: (...values) { this.values = values; return this; },
      async first() {
        if (this.sql.includes("FROM staff_memberships sm JOIN companies c")) {
          return this.values[0] === "identity-1" && this.values[1] === "company-1"
            ? this.membership
            : null;
        }
        if (this.sql.includes("FROM branches WHERE company_id=?1 AND id=?2")) {
          const [companyId, branchId] = this.values;
          return companyId === "company-1" && this.db.activeBranches.has(branchId) ? { id: branchId } : null;
        }
        if (this.sql.includes("FROM staff_work_assignments a JOIN branches b")) {
          const [companyId, staffMembershipId, branchId, workArea] = this.values;
          return this.db.assignments.find(row =>
            row.company_id === companyId
            && row.staff_membership_id === staffMembershipId
            && row.branch_id === branchId
            && row.work_area === workArea
            && row.status === "ACTIVE"
          ) ?? null;
        }
        return null;
      },
      async all() {
        if (this.sql.includes("FROM products WHERE company_id")) {
          return { results: [{ id: "product-1", name: "Synthetic product", cost_amount: 100, selling_amount: 200 }] };
        }
        if (this.sql.includes("FROM agency_operations WHERE company_id")) {
          return { results: [{ id: "agency-1", branch_id: "branch-1", provider_code: "AIRTEL_MONEY" }] };
        }
        if (this.sql.includes("FROM cash_accounts a JOIN branches b")) {
          return { results: [{ id: "cash-1", branch_id: "branch-1", work_area: "MOBILE_MONEY" }] };
        }
        return { results: [] };
      },
      async run() {
        throw new Error("Unexpected write in read-only API contract test");
      },
    };
    statement.db = this;
    return statement;
  }

  async batch() {
    throw new Error("Unexpected batch in read-only API contract test");
  }
}

const activeMembership = {
  membership_id: "staff-1",
  company_id: "company-1",
  branch_id: null,
  display_name: "Synthetic worker",
  email: "worker@example.invalid",
  role_key: "AGENT",
  status: "ACTIVE",
  company_name: "Synthetic Otya company",
};

function makeEnv(workArea) {
  const assignments = workArea ? [{
    id: "assignment-1",
    company_id: "company-1",
    staff_membership_id: "staff-1",
    branch_id: "branch-1",
    work_area: workArea,
    duty_role: "OPERATOR",
    status: "ACTIVE",
  }] : [];
  return {
    DB: new MemoryD1({ membership: activeMembership, assignments, activeBranches: ["branch-1", "branch-2"] }),
    OTYA_ID: {
      async fetch() {
        return Response.json({
          ok: true,
          user_id: "identity-1",
          email: "worker@example.invalid",
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

test("Mobile Money-only worker cannot read the Retail product catalogue", async () => {
  const response = await worker.fetch(
    apiRequest("/v1/products?companyId=company-1&branchId=branch-1"),
    makeEnv("MOBILE_MONEY"),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "work_area_assignment_required");
});

test("Retail-only worker cannot read Mobile Money agency operations", async () => {
  const response = await worker.fetch(
    apiRequest("/v1/agency/operations?companyId=company-1&branchId=branch-1"),
    makeEnv("RETAIL"),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "work_area_assignment_required");
});

test("Retail assignment can read Retail catalogue but cannot cross to another branch", async () => {
  const env = makeEnv("RETAIL");
  const allowed = await worker.fetch(
    apiRequest("/v1/products?companyId=company-1&branchId=branch-1"),
    env,
  );
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data[0].cost_amount, null);

  const crossBranch = await worker.fetch(
    apiRequest("/v1/products?companyId=company-1&branchId=branch-2"),
    env,
  );
  assert.equal(crossBranch.status, 403);
  assert.equal((await crossBranch.json()).error, "work_area_assignment_required");
});

test("Mobile Money assignment can read agency operations for its assigned branch", async () => {
  const response = await worker.fetch(
    apiRequest("/v1/agency/operations?companyId=company-1&branchId=branch-1"),
    makeEnv("MOBILE_MONEY"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].id, "agency-1");
});

test("cash account views require a declared work area for non-privileged staff", async () => {
  const response = await worker.fetch(
    apiRequest("/v1/cash/accounts?companyId=company-1&branchId=branch-1"),
    makeEnv("MOBILE_MONEY"),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "work_area_required");
});

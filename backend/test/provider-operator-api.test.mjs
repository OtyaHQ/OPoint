import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

class MemoryD1 {
  constructor(roleKey) {
    this.roleKey = roleKey;
    this.calls = [];
    this.prepare = (sql) => {
      const values = [];
      const statement = {
        sql,
        bind(...nextValues) { values.splice(0, values.length, ...nextValues); return statement; },
        first: async () => {
          this.calls.push({ kind: "first", sql, values: [...values] });
          if (sql.includes("FROM staff_memberships sm JOIN companies c")) {
            return {
              membership_id: "membership-1",
              company_id: "company-1",
              branch_id: "branch-1",
              display_name: "Synthetic test owner",
              email: "owner@example.invalid",
              role_key: this.roleKey,
              status: "ACTIVE",
              company_name: "Synthetic Otya company",
            };
          }
          return null;
        },
        all: async () => {
          this.calls.push({ kind: "all", sql, values: [...values] });
          return { results: [] };
        },
        run: async () => {
          this.calls.push({ kind: "run", sql, values: [...values] });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    };
  }
  async batch() {
    throw new Error("Unexpected database write in read-only provider access test");
  }
}

function makeEnv(roleKey) {
  const DB = new MemoryD1(roleKey);
  return {
    DB,
    OID: {
      async fetch() {
        return Response.json({ ok: true, user_id: "identity-1", email: "owner@example.invalid" });
      },
    },
  };
}

function request(path, method = "GET", body = undefined, company = true) {
  return new Request("https://opoint.internal" + path + (company ? "?companyId=company-1" : ""), {
    method,
    headers: {
      authorization: "Bearer synthetic-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("Manager membership cannot administer company provider relationships", async () => {
  const env = makeEnv("MANAGER");
  const response = await worker.fetch(request("/v1/provider-relationships"), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "owner_or_admin_required");
  assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 0);
});

test("Owner can list provider relationships within the selected company", async () => {
  const env = makeEnv("OWNER");
  const response = await worker.fetch(request("/v1/provider-relationships"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 1);
});

test("provider relationship write API rejects PIN and KYC fields", async () => {
  const env = makeEnv("OWNER");
  const response = await worker.fetch(request("/v1/provider-relationships", "POST", {
    providerCode: "AIRTEL_MONEY",
    legalEntityName: "Otya Holdings Limited",
    corporateAgentReference: "CORP-AGENT-001",
    agreementReference: "AGREEMENT-2026-001",
    reason: "Provider onboarding",
    pin: "1234",
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "sensitive_identity_or_credential_field_not_accepted");
  assert.equal(env.DB.calls.filter(call => call.kind === "run").length, 0);
});

test("signed-in employee provider endpoint returns only its own active assignments", async () => {
  const env = makeEnv("AGENT");
  const response = await worker.fetch(request("/v1/me/provider-operator-assignments", "GET", undefined, false), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  const query = env.DB.calls.find(call => call.kind === "all")?.sql || "";
  assert.match(query, /sm\.identity_subject=\?1/);
  assert.match(query, /pg\.scope_type='PROVIDER_ACCOUNT'/);
  assert.match(query, /op\.approval_status='APPROVED'/);
});

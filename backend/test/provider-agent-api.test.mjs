import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

class MemoryD1 {
  constructor(roleKey) {
    this.roleKey = roleKey;
    this.calls = [];
  }
  prepare(sql) {
    const db = this;
    const statement = {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        db.calls.push({ kind: "first", sql: this.sql, values: this.values });
        if (this.sql.includes("FROM staff_memberships sm JOIN companies c")) {
          if (this.values[0] === "identity-1" && this.values[1] === "company-1") {
            return {
              membership_id: "staff-1",
              company_id: "company-1",
              branch_id: "branch-1",
              display_name: "Synthetic member",
              email: "member@example.invalid",
              role_key: db.roleKey,
              status: "ACTIVE",
              company_name: "Synthetic company",
            };
          }
        }
        return null;
      },
      async all() {
        db.calls.push({ kind: "all", sql: this.sql, values: this.values });
        return { results: [] };
      },
      async run() {
        db.calls.push({ kind: "run", sql: this.sql, values: this.values });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
  async batch() {
    throw new Error("Unexpected write in provider-agent access test");
  }
}

function makeEnv(roleKey) {
  const DB = new MemoryD1(roleKey);
  return {
    DB,
    OTYA_ID: {
      async fetch() {
        return Response.json({ ok: true, user_id: "identity-1", email: "member@example.invalid" });
      },
    },
  };
}

function request(method = "GET", body = undefined) {
  return new Request("https://opoint.internal/v1/provider-agent-accounts?companyId=company-1", {
    method,
    headers: {
      authorization: "Bearer synthetic-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("ordinary Manager membership cannot enumerate provider-agent accounts", async () => {
  const env = makeEnv("MANAGER");
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "owner_or_admin_required");
  assert.equal(env.DB.calls.length, 1);
});

test("Owner can enumerate provider-agent accounts within the selected company", async () => {
  const env = makeEnv("OWNER");
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 1);
});

test("provider-agent write API rejects PIN, OTP and personal phone data", async () => {
  for (const field of [{ pin: "1234" }, { otp: "123456" }, { phoneNumber: "+256700000000" }]) {
    const env = makeEnv("OWNER");
    const response = await worker.fetch(request("POST", {
      providerCode: "MTN_MOMO",
      branchId: "branch-1",
      providerAgentReference: "MTN-AGENT-0041",
      displayLabel: "Main MTN account",
      reason: "Provider account registration",
      ...field,
    }), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "sensitive_credentials_or_identity_data_not_accepted");
    assert.equal(env.DB.calls.length, 1);
  }
});

test("signed-in staff can retrieve only their active provider-account assignment view", async () => {
  const env = makeEnv("AGENT");
  const response = await worker.fetch(new Request(
    "https://opoint.internal/v1/me/provider-agent-assignments",
    { method: "GET", headers: { authorization: "Bearer synthetic-token" } },
  ), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  assert.equal(env.DB.calls.filter(call => call.kind === "all").length, 1);
});

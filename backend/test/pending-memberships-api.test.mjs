import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

class PendingMembershipD1 {
  constructor() {
    this.calls = [];
  }

  prepare(sql) {
    const calls = this.calls;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async all() {
        calls.push({ sql: this.sql, values: [...this.values] });
        return {
          results: [{
            membership_id: "membership-pending-1",
            company_id: "company-1",
            company_name: "Otya Retail",
            company_slug: "otya-retail",
            display_name: "New Cashier",
            email: "cashier@example.invalid",
            role_key: "CASHIER",
            status: "PENDING",
            created_at: "2026-11-18T08:00:00.000Z",
          }],
        };
      },
      async first() { throw new Error("Unexpected database first() call"); },
      async run() { throw new Error("Unexpected database write"); },
    };
  }

  async batch() { throw new Error("Unexpected database batch"); }
}

function request(path, token = "synthetic-access-token") {
  return new Request("https://opoint.internal" + path, {
    method: "GET",
    headers: token ? { authorization: "Bearer " + token } : {},
  });
}

function makeEnv() {
  const DB = new PendingMembershipD1();
  return {
    DB,
    OTYA_ID: {
      async fetch(req) {
        assert.equal(req.url, "https://auth/auth/verify");
        assert.equal(req.headers.get("authorization"), "Bearer synthetic-access-token");
        return Response.json({
          ok: true,
          user_id: "identity-worker-1",
          email: "cashier@example.invalid",
          email_verified: true,
        });
      },
    },
  };
}

test("a signed-in worker can see only pending memberships bound to their Otya ID subject", async () => {
  const env = makeEnv();
  const response = await worker.fetch(request("/v1/me/pending-memberships"), env);
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].membership_id, "membership-pending-1");
  assert.equal(body.data[0].status, "PENDING");
  assert.equal(body.data[0].role_key, "CASHIER");

  assert.equal(env.DB.calls.length, 1);
  assert.deepEqual(env.DB.calls[0].values, ["identity-worker-1"]);
  assert.match(env.DB.calls[0].sql, /sm\.identity_subject=\?1/);
  assert.match(env.DB.calls[0].sql, /sm\.status='PENDING'/);
  assert.doesNotMatch(env.DB.calls[0].sql, /national_id|passport|document_url|kyc_document/i);
});

test("pending membership discovery rejects anonymous requests before querying D1", async () => {
  const env = makeEnv();
  const response = await worker.fetch(request("/v1/me/pending-memberships", null), env);
  assert.equal(response.status, 401);
  assert.equal(env.DB.calls.length, 0);
});

test("pending membership discovery ignores caller-supplied identity selectors", async () => {
  const env = makeEnv();
  const response = await worker.fetch(
    request("/v1/me/pending-memberships?userId=another-worker&identitySubject=another-worker"),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(env.DB.calls[0].values, ["identity-worker-1"]);
});

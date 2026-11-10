import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-agency-readiness-"));
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const manager = {
  id: "staff-manager", identity_subject: "identity-manager", company_id: "company-a",
  branch_id: null, role: "MANAGER", status: "ACTIVE", display_name: "Manager",
  email: null, agent_id: null
};
const attendant = {
  id: "staff-attendant", identity_subject: "identity-attendant", company_id: "company-a",
  branch_id: "branch-a", role: "ATTENDANT", status: "ACTIVE", display_name: "Attendant",
  email: null, agent_id: "agent-a"
};

function makeEnv({ staff = manager, totals = [3, 1, 1], providers = [], authResponse, authError } = {}) {
  const calls = { queries: [], writes: 0, batches: 0 };
  const env = {
    DB: {
      prepare(sql) {
        const statement = { sql, values: [], bind(...values) { this.values = values; return this; },
          async first() {
            calls.queries.push({ kind: "first", sql: this.sql, values: this.values });
            if (this.sql.includes("FROM omni_staff_memberships")) return staff;
            if (this.sql.includes("COUNT(*) AS total")) {
              const index = this.sql.includes("provider_status IN ('DRAFT','PENDING')") ? 1
                : this.sql.includes("provider_status = 'UNKNOWN'") ? 2 : 0;
              return { total: totals[index] };
            }
            throw new Error("Unexpected first query: " + this.sql);
          },
          async all() {
            calls.queries.push({ kind: "all", sql: this.sql, values: this.values });
            if (this.sql.includes("GROUP BY provider")) return { results: providers };
            throw new Error("Unexpected all query: " + this.sql);
          },
          async run() { calls.writes++; throw new Error("Unexpected write in read-only readiness handler"); }
        };
        return statement;
      },
      async batch() { calls.batches++; throw new Error("Unexpected batch in read-only readiness handler"); }
    },
    PRIVATE_FILES: {}, BACKUPS: {}, CACHE: {}, JOBS: {},
    AUTH: { async fetch() {
      if (authError) throw authError;
      return Response.json(authResponse ?? { ok: true, user_id: staff.identity_subject });
    } }
  };
  return { env, calls };
}

async function readiness(env) {
  return worker.fetch(new Request("https://otyapoint.test/api/agency-readiness", {
    method: "GET", headers: { authorization: "Bearer synthetic-token" }
  }), env);
}

test("manager receives company-scoped operational counts and disabled provider states", async () => {
  const { env, calls } = makeEnv({
    totals: [7, 2, 1],
    providers: [{ provider: "airtel_money", transactions: 4 }, { provider: null, transactions: 3 }]
  });
  const response = await readiness(env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, "otyapoint-agency");
  assert.equal(body.mode, "LOCAL_RECORDS_ONLY");
  assert.equal(body.currency, "UGX");
  assert.equal(body.liveMoneyEnabled, false);
  assert.equal(body.transactionCreation, "DISABLED_UNTIL_PROVIDER_ADAPTERS_AND_CONTROLS_ARE_VERIFIED");
  assert.deepEqual(body.providers.map(provider => [provider.id, provider.status, provider.adapter]), [
    ["interswitch_marketplace_routing", "NOT_READY", "NOT_IMPLEMENTED"],
    ["quickteller_business", "NOT_CONFIGURED", "SANDBOX_STATUS_CLIENT_ONLY"],
    ["airtel_money", "NOT_READY", "NOT_IMPLEMENTED"],
    ["mtn_mobile_money", "NOT_READY", "NOT_IMPLEMENTED"]
  ]);
  assert.deepEqual(body.records, {
    total: 7, pending: 2, unknownOrNeedsReconciliation: 1,
    byProvider: [{ provider: "airtel_money", transactions: 4 }, { provider: "UNSPECIFIED", transactions: 3 }]
  });
  const dataQueries = calls.queries.filter(query => !query.sql.includes("omni_staff_memberships"));
  assert.equal(dataQueries.length, 4);
  assert.ok(dataQueries.every(query => query.values[0] === "company-a"));
  assert.equal(calls.writes, 0);
  assert.equal(calls.batches, 0);
});

test("attendants cannot view company-wide readiness", async () => {
  const { env, calls } = makeEnv({ staff: attendant });
  const response = await readiness(env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
  assert.equal(calls.queries.filter(query => !query.sql.includes("omni_staff_memberships")).length, 0);
  assert.equal(calls.writes, 0);
});

test("unverified identities cannot read agency readiness", async () => {
  const { env, calls } = makeEnv({ authResponse: { ok: false, user_id: "identity-manager" } });
  const response = await readiness(env);
  assert.equal(response.status, 401);
  assert.equal(calls.queries.filter(query => !query.sql.includes("omni_staff_memberships")).length, 0);
});

test("Auth outage fails closed before querying company records", async () => {
  const { env, calls } = makeEnv({ authError: new Error("synthetic auth outage") });
  const response = await readiness(env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "auth_service_unavailable" });
  assert.equal(calls.queries.length, 0);
});

test("unknown identities cannot query agency readiness", async () => {
  const { env, calls } = makeEnv({ staff: null, authResponse: { ok: true, user_id: "unmapped-identity" } });
  const response = await readiness(env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "staff_access_denied" });
  assert.equal(calls.queries.filter(query => !query.sql.includes("omni_staff_memberships")).length, 0);
});

test("transaction creation remains disabled after exposing read-only readiness", async () => {
  const { env, calls } = makeEnv();
  const response = await worker.fetch(new Request("https://otyapoint.test/api/agency-transactions", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-token",
      "content-type": "application/json",
      "idempotency-key": "agency-test-0001"
    },
    body: JSON.stringify({
      provider: "airtel_money", transactionType: "CASH_IN", amount: 1000,
      customerReference: "synthetic-customer"
    })
  }), env);
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "provider_adapter_required",
    detail: "No provider call was made and no agency transaction was recorded."
  });
  assert.equal(calls.writes, 0);
  assert.equal(calls.batches, 0);
  assert.equal(calls.queries.filter(query => !query.sql.includes("omni_staff_memberships")).length, 0);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

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
}).outputText.replace('./providers/quickteller-business-sandbox', './quickteller-business-sandbox.mjs');
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-agency-list-"));
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiledProvider = ts.transpileModule(providerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
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

function makeEnv({ staff = manager, rows = [], authResponse, authError } = {}) {
  const calls = { queries: [], auth: [] };
  const env = {
    DB: {
      prepare(sql) {
        const statement = { sql, values: [], bind(...values) { this.values = values; return this; },
          async first() {
            calls.queries.push({ kind: "first", sql: this.sql, values: this.values });
            if (this.sql.includes("FROM omni_staff_memberships")) return staff;
            throw new Error("Unexpected first query");
          },
          async all() {
            calls.queries.push({ kind: "all", sql: this.sql, values: this.values });
            if (this.sql.includes("FROM omni_agency_transactions")) return { results: rows };
            throw new Error("Unexpected all query");
          },
          async run() { throw new Error("Unexpected write in read-only agency test"); }
        };
        return statement;
      },
      async batch() { throw new Error("Unexpected batch in read-only agency test"); }
    },
    PRIVATE_FILES: {}, BACKUPS: {}, CACHE: {}, JOBS: {},
    AUTH: { async fetch(request) {
      calls.auth.push({ url: request.url, authorization: request.headers.get("authorization") });
      if (authError) throw authError;
      return Response.json(authResponse ?? { ok: true, user_id: staff.identity_subject });
    } }
  };
  return { env, calls };
}

async function list(env, query = "") {
  return worker.fetch(new Request(`https://otyapoint.test/api/agency-transactions${query}`, {
    method: "GET", headers: { authorization: "Bearer synthetic-token" }
  }), env);
}

test("manager list is company-scoped, bounded, and omits request/response metadata", async () => {
  const row = { id: "txn-1", reference: "AG-001", transaction_type: "CASH_IN",
    provider: "manual", provider_reference: null, provider_status: "SUCCEEDED",
    amount: 50000, commission: 1000, currency: "UGX", customer_reference: "customer-ref",
    actor_id: "staff-attendant", created_at: "2026-10-30T10:00:00Z", updated_at: "2026-10-30T10:00:00Z" };
  const { env, calls } = makeEnv({ staff: manager, rows: [row] });
  const response = await list(env, "?type=CASH_IN&status=SUCCEEDED");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [row]);
  const query = calls.queries.find(call => call.kind === "all");
  assert.ok(query);
  assert.match(query.sql, /company_id = \?1/);
  assert.match(query.sql, /transaction_type = \?2/);
  assert.match(query.sql, /provider_status = \?3/);
  assert.match(query.sql, /LIMIT 100/);
  assert.deepEqual(query.values, ["company-a", "CASH_IN", "SUCCEEDED"]);
  assert.doesNotMatch(query.sql, /request_metadata|response_metadata/);
});

test("non-manager staff list is restricted to their own transactions", async () => {
  const { env, calls } = makeEnv({ staff: attendant });
  const response = await list(env);
  assert.equal(response.status, 200);
  const query = calls.queries.find(call => call.kind === "all");
  assert.ok(query);
  assert.match(query.sql, /company_id = \?1/);
  assert.match(query.sql, /actor_id = \?2/);
  assert.deepEqual(query.values, ["company-a", "staff-attendant"]);
});

test("rejects unknown transaction type or status without listing records", async () => {
  const { env, calls } = makeEnv();
  assert.equal((await list(env, "?type=UNKNOWN_TYPE")).status, 400);
  assert.equal((await list(env, "?status=NOT_A_STATUS")).status, 400);
  assert.equal(calls.queries.filter(call => call.kind === "all").length, 0);
});

test("fails closed when Otya Auth does not verify the identity", async () => {
  const { env, calls } = makeEnv({ authResponse: { ok: false, user_id: "identity-manager" } });
  const response = await list(env);
  assert.equal(response.status, 401);
  assert.equal(calls.queries.filter(call => call.kind === "all").length, 0);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

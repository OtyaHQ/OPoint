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
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-health-readiness-"));
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const requiredTables = [
  "omni_products", "omni_retail_sales", "omni_retail_sale_lines",
  "omni_stock_movements", "omni_agency_transactions", "omni_ledger_entries",
  "omni_reconciliation_sessions", "omni_audit_events", "omni_staff_memberships",
  "omni_staff_invitations", "omni_agency_accounts", "omni_agency_operations",
  "omni_agency_account_movements",
];

const requiredObjects = [
  "idx_omni_sales_company_idempotency",
  "idx_omni_one_active_sovereign_per_company",
  "idx_omni_owner_bootstrap_once",
  "idx_omni_staff_company_status_role",
  "idx_omni_staff_invitation_pending_email",
  "idx_omni_staff_invitation_company_status",
  "idx_omni_staff_invitation_expiry",
  "omni_staff_invitation_membership_guard",
  "omni_ledger_entries_no_update",
  "omni_ledger_entries_no_delete",
  "omni_stock_movements_no_update",
  "omni_stock_movements_no_delete",
  "omni_audit_events_no_update",
  "omni_audit_events_no_delete",
  "idx_omni_agency_one_active_cash_drawer",
  "idx_omni_agency_one_active_provider_float",
  "omni_agency_account_movement_guard",
  "omni_agency_account_movement_apply",
  "omni_agency_operations_guard",
  "omni_agency_operations_no_update",
  "omni_agency_operations_no_delete",
  "omni_agency_account_movements_no_update",
  "omni_agency_account_movements_no_delete",
];

function makeEnv({ tables = requiredTables, objects = requiredObjects, fail = false } = {}) {
  const queries = [];
  return {
    queries,
    DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          async all() {
            if (fail) throw new Error("synthetic database failure");
            if (sql.includes("type='table'")) return { results: tables.map(name => ({ name })) };
            if (sql.includes("type IN ('index','trigger')")) return { results: objects.map(name => ({ name })) };
            throw new Error("Unexpected health query: " + sql);
          },
        };
      },
    },
  };
}

async function health(env) {
  return worker.fetch(new Request("https://otyapoint.test/health", {
    method: "GET",
    headers: { "cf-ray": "health-test-request" },
  }), env);
}

test("health reports ready only when all current schema tables and integrity objects exist", async () => {
  const env = makeEnv();
  const response = await health(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "otyapoint-api",
    status: "ok",
    schemaReady: true,
    requestId: "health-test-request",
  });
  assert.equal(env.queries.length, 2);
});

test("health fails closed when invitation and cash/float migrations are missing", async () => {
  const tables = requiredTables.filter(name =>
    !["omni_staff_invitations", "omni_agency_accounts", "omni_agency_operations", "omni_agency_account_movements"].includes(name)
  );
  const response = await health(makeEnv({ tables }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "schema_not_ready");
  assert.equal(body.schemaReady, false);
});

test("health fails closed when append-only or cash/float integrity triggers are missing", async () => {
  const objects = requiredObjects.filter(name =>
    !["omni_ledger_entries_no_update", "omni_agency_account_movement_guard"].includes(name)
  );
  const response = await health(makeEnv({ objects }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "schema_not_ready");
  assert.equal(body.schemaReady, false);
});

test("database errors return unavailable instead of a false healthy result", async () => {
  const response = await health(makeEnv({ fail: true }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "database_unavailable");
  assert.equal(body.schemaReady, undefined);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

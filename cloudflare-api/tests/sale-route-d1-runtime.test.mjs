import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Miniflare } from "miniflare";

const migrationsDir = new URL("../migrations/", import.meta.url);
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace('./providers/quickteller-business-sandbox', './quickteller-business-sandbox.mjs');
const tempDir = mkdtempSync(join(tmpdir(), "omnipoint-d1-runtime-"));
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiledProvider = ts.transpileModule(providerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('test runtime'); } };",
  compatibilityDate: "2026-08-06",
  d1Databases: { DB: "omnipoint-isolated-test" }
});
const db = await mf.getD1Database("DB");

async function run(sql, ...values) {
  return db.prepare(sql).bind(...values).run();
}
async function first(sql, ...values) {
  return db.prepare(sql).bind(...values).first();
}
async function count(table, where = "1=1") {
  const row = await first("SELECT COUNT(*) AS count FROM " + table + " WHERE " + where);
  return Number(row.count);
}
async function resetAndMigrate() {
  // This D1 database is created by Miniflare in-memory/local test state, never Wrangler remote mode.
  for (const name of [
    "0001_core.sql",
    "0002_company_scope.sql",
    "0003_staff_profile.sql",
    "0004_sale_request_fingerprint.sql",
    "0005_company_scoped_sale_idempotency.sql"
  ]) {
    const sql = readFileSync(new URL(name, migrationsDir), "utf8")
      .replace(/^[ \t]*--[^\n]*(?:\n|$)/gm, "");
    await db.exec(sql.replace(/\s*\n\s*/g, " "));
  }
  await run(
    `INSERT INTO omni_staff_memberships
       (id, identity_subject, company_id, branch_id, role, status, display_name, email)
       VALUES (?, ?, ?, ?, 'SOVEREIGN', 'ACTIVE', ?, ?)`,
    "staff-d1", "identity-d1", "company-d1", "branch-d1", "Synthetic D1 Staff", "d1-test@example.invalid"
  );
  await run(
    `INSERT INTO omni_products
       (id, sku, name, category, cost_price, selling_price, quantity_on_hand, company_id)
       VALUES (?, ?, ?, 'Test', 100, 200, ?, ?)`,
    "product-good", "SKU-D1-GOOD", "Synthetic Good Stock", 2, "company-d1"
  );
  await run(
    `INSERT INTO omni_products
       (id, sku, name, category, cost_price, selling_price, quantity_on_hand, company_id)
       VALUES (?, ?, ?, 'Test', 100, 200, ?, ?)`,
    "product-short", "SKU-D1-SHORT", "Synthetic Limited Stock", 2, "company-d1"
  );
}

const env = {
  DB: db,
  PRIVATE_FILES: {},
  BACKUPS: {},
  CACHE: {},
  JOBS: {},
  AUTH: {
    async fetch() {
      return Response.json({ ok: true, user_id: "identity-d1", email: "d1-test@example.invalid" });
    }
  }
};

async function postSale(key, items) {
  return worker.fetch(new Request("https://omnipoint.test/api/sales", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-d1-token",
      "content-type": "application/json",
      "idempotency-key": key
    },
    body: JSON.stringify({ paymentMethod: "CASH", items })
  }), env);
}

test("real sales handler uses Miniflare D1 and atomically rolls back a late stock failure", async () => {
  try {
    await resetAndMigrate();

    const failed = await postSale("d1-atomic-key-001", [
      { productId: "product-good", quantity: 1 },
      { productId: "product-short", quantity: 3 }
    ]);
    assert.equal(failed.status, 409, await failed.text());

    assert.equal(await first("SELECT quantity_on_hand FROM omni_products WHERE id='product-good'").then(r => r.quantity_on_hand), 2);
    assert.equal(await first("SELECT quantity_on_hand FROM omni_products WHERE id='product-short'").then(r => r.quantity_on_hand), 2);
    assert.equal(await count("omni_retail_sales"), 0);
    assert.equal(await count("omni_retail_sale_lines"), 0);
    assert.equal(await count("omni_stock_movements"), 0);
    assert.equal(await count("omni_ledger_entries"), 0);
    assert.equal(await count("omni_audit_events"), 0);

    const successful = await postSale("d1-atomic-key-002", [
      { productId: "product-good", quantity: 1 }
    ]);
    assert.equal(successful.status, 201, await successful.text());
    const replay = await postSale("d1-atomic-key-002", [
      { productId: "product-good", quantity: 1 }
    ]);
    const replayBody = await replay.json();
    assert.equal(replay.status, 200, JSON.stringify(replayBody));
    assert.equal(replayBody.replayed, true);

    assert.equal(await count("omni_retail_sales"), 1);
    assert.equal(await count("omni_retail_sale_lines"), 1);
    assert.equal(await count("omni_stock_movements"), 1);
    assert.equal(await count("omni_ledger_entries"), 4); // cash/revenue plus COGS/inventory double-entry postings
    assert.equal(await count("omni_audit_events"), 1);
    assert.equal(await first("SELECT quantity_on_hand FROM omni_products WHERE id='product-good'").then(r => r.quantity_on_hand), 1);

    const fk = await db.prepare("PRAGMA foreign_key_check").all();
    assert.deepEqual(fk.results, []);
    const ledger = await first("SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM omni_ledger_entries");
    assert.equal(ledger.debit, ledger.credit, "sale ledger postings must balance");
  } finally {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { saleRequestFingerprint } from "../src/sale-fingerprint.mjs";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace('./providers/quickteller-business-sandbox', './quickteller-business-sandbox.mjs');
const tempDir = mkdtempSync(join(tmpdir(), "omnipoint-route-test-"));
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiledProvider = ts.transpileModule(providerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const workerModule = await import(pathToFileURL(join(tempDir, "index.mjs")).href);
const worker = workerModule.default;
const staff = {
  id: "staff-1", identity_subject: "identity-1", company_id: "company-1",
  branch_id: "branch-1", role: "SOVEREIGN", status: "ACTIVE",
  display_name: "Synthetic Staff", email: "synthetic@example.invalid", agent_id: null
};
const savedLines = [{ productId: "product-1", quantity: 1 }];
const savedFingerprint = await saleRequestFingerprint("CASH", savedLines);

function makeEnv(existingSale) {
  const calls = { existingSaleLookups: 0, batchCalls: 0, queries: [] };
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          calls.queries.push(this.sql);
          if (this.sql.includes("FROM omni_staff_memberships")) return staff;
          if (this.sql.includes("FROM omni_retail_sales")) {
            calls.existingSaleLookups++;
            return existingSale;
          }
          throw new Error("Unexpected first() SQL in route test: " + this.sql);
        },
        async all() { throw new Error("Unexpected all() call in replay test"); },
        async run() { throw new Error("Unexpected run() call in replay test"); }
      };
      return statement;
    },
    async batch() { calls.batchCalls++; throw new Error("Replay path must not write a batch"); }
  };
  return {
    calls,
    env: {
      DB: db,
      PRIVATE_FILES: {}, BACKUPS: {}, CACHE: {}, JOBS: {},
      AUTH: { async fetch() { return Response.json({ ok: true, user_id: "identity-1", email: "synthetic@example.invalid" }); } }
    }
  };
}

async function postSale(env, paymentMethod = "CASH", items = savedLines) {
  return worker.fetch(new Request("https://omnipoint.test/api/sales", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-token",
      "content-type": "application/json",
      "idempotency-key": "sale-key-0001"
    },
    body: JSON.stringify({ paymentMethod, items })
  }), env);
}

test("actual sales route replays an identical request without writing again", async () => {
  const { env, calls } = makeEnv({
    id: "sale-1", receipt_number: "OP-TEST-1", total: 200, status: "COMPLETED",
    request_fingerprint: savedFingerprint
  });
  const response = await postSale(env, "CASH");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replayed, true);
  assert.equal(calls.existingSaleLookups, 1);
  assert.equal(calls.batchCalls, 0);
});

test("actual sales route returns 409 when payment method differs for a reused key", async () => {
  const { env, calls } = makeEnv({
    id: "sale-1", receipt_number: "OP-TEST-1", total: 200, status: "COMPLETED",
    request_fingerprint: savedFingerprint
  });
  const response = await postSale(env, "MOBILE_MONEY");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "idempotency_key_payload_conflict");
  assert.equal(calls.existingSaleLookups, 1);
  assert.equal(calls.batchCalls, 0);
});

test("actual sales route fails closed for a legacy sale without a fingerprint", async () => {
  const { env, calls } = makeEnv({
    id: "sale-legacy", receipt_number: "OP-LEGACY", total: 200, status: "COMPLETED",
    request_fingerprint: null
  });
  const response = await postSale(env, "CASH");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "idempotency_key_payload_conflict");
  assert.equal(calls.batchCalls, 0);
});

test("actual sales route still rejects a new unsupported payment method", async () => {
  const { env, calls } = makeEnv(null);
  const response = await postSale(env, "MOBILE_MONEY");
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "payment_method_not_enabled");
  assert.equal(calls.existingSaleLookups, 1);
  assert.equal(calls.batchCalls, 0);
});


test("actual sales route rejects changed product or quantity for a reused key", async (t) => {
  for (const items of [
    [{ productId: "product-2", quantity: 1 }],
    [{ productId: "product-1", quantity: 2 }]
  ]) {
    await t.test(JSON.stringify(items), async () => {
      const { env, calls } = makeEnv({
        id: "sale-1", receipt_number: "OP-TEST-1", total: 200, status: "COMPLETED",
        request_fingerprint: savedFingerprint
      });
      const response = await postSale(env, "CASH", items);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "idempotency_key_payload_conflict");
      assert.equal(calls.batchCalls, 0);
    });
  }
});

test("concurrent identical requests produce one creation and one replay in the handler", async () => {
  const calls = { lookupCount: 0, batchCount: 0, acceptedBatches: 0 };
  let savedSale = null;
  const product = { id: "product-1", sku: "SKU-1", name: "Synthetic Product", cost_price: 100, selling_price: 200, quantity_on_hand: 5, is_active: 1 };
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (this.sql.includes("FROM omni_staff_memberships")) return staff;
          if (this.sql.includes("FROM omni_retail_sales")) {
            calls.lookupCount++;
            // Let both initial lookups observe absence, forcing the second request down the
            // unique-conflict recovery path after the first batch commits.
            if (calls.lookupCount <= 2) return null;
            return savedSale;
          }
          throw new Error("Unexpected first() SQL in concurrency test: " + this.sql);
        },
        async all() {
          if (this.sql.includes("FROM omni_products")) return { results: [product] };
          throw new Error("Unexpected all() SQL in concurrency test: " + this.sql);
        },
        async run() { throw new Error("Unexpected run() SQL in concurrency test: " + this.sql); }
      };
      return statement;
    },
    async batch(statements) {
      calls.batchCount++;
      if (calls.acceptedBatches > 0) throw new Error("UNIQUE constraint failed: omni_retail_sales.company_id, omni_retail_sales.idempotency_key");
      calls.acceptedBatches++;
      const sale = statements[0].values;
      savedSale = {
        id: sale[0], receipt_number: sale[1], total: sale[2], status: "COMPLETED",
        request_fingerprint: sale[7]
      };
      return [];
    }
  };
  const env = {
    DB: db, PRIVATE_FILES: {}, BACKUPS: {}, CACHE: {}, JOBS: {},
    AUTH: { async fetch() { return Response.json({ ok: true, user_id: "identity-1", email: "synthetic@example.invalid" }); } }
  };
  const [first, second] = await Promise.all([postSale(env), postSale(env)]);
  const responses = await Promise.all([first.json(), second.json()]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(responses.filter(body => body.replayed === true).length, 1);
  assert.equal(calls.batchCount, 2);
  assert.equal(calls.acceptedBatches, 1);
});


test("actual sales route maps a stock-trigger failure to 409 without reporting success", async () => {
  const calls = { batchCalls: 0 };
  const product = { id: "product-1", sku: "SKU-1", name: "Synthetic Product", cost_price: 100, selling_price: 200, quantity_on_hand: 0, is_active: 1 };
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (this.sql.includes("FROM omni_staff_memberships")) return staff;
          if (this.sql.includes("FROM omni_retail_sales")) return null;
          throw new Error("Unexpected first() SQL in stock conflict test: " + this.sql);
        },
        async all() {
          if (this.sql.includes("FROM omni_products")) return { results: [product] };
          throw new Error("Unexpected all() SQL in stock conflict test: " + this.sql);
        },
        async run() { throw new Error("Unexpected run() SQL in stock conflict test: " + this.sql); }
      };
      return statement;
    },
    async batch() {
      calls.batchCalls++;
      throw new Error("INSUFFICIENT_STOCK");
    }
  };
  const env = {
    DB: db, PRIVATE_FILES: {}, BACKUPS: {}, CACHE: {}, JOBS: {},
    AUTH: { async fetch() { return Response.json({ ok: true, user_id: "identity-1", email: "synthetic@example.invalid" }); } }
  };
  const response = await postSale(env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "stock_conflict_or_product_unavailable");
  assert.equal(calls.batchCalls, 1);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

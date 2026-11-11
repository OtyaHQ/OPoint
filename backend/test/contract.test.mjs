import test from "node:test";
import assert from "node:assert/strict";
import worker, { isUGXAmount, normalizeCompanyName, normalizeSlug, parseProductInput, REQUIRED_TABLES, REQUIRED_GUARDS } from "../src/index.mjs";

test("company name and slug normalization are bounded and stable", () => {
  assert.equal(normalizeCompanyName("  Otya   Retail  "), "Otya Retail");
  assert.equal(normalizeSlug("Mbirizi Electronics & Phones"), "mbirizi-electronics-phones");
  assert.match(normalizeSlug(""), /^[a-z0-9-]+$/);
});

test("money validation accepts integer UGX only", () => {
  assert.equal(isUGXAmount(125000), true);
  assert.equal(isUGXAmount(0), true);
  assert.equal(isUGXAmount(12.5), false);
  assert.equal(isUGXAmount(-1), false);
  assert.equal(isUGXAmount(Number.MAX_SAFE_INTEGER), false);
});

test("product input rejects floats and malformed SKU", () => {
  assert.equal(parseProductInput({ sku: "PHONE-01", name: "Android phone", costAmount: 1000, sellingAmount: 1500 }).value.sellingAmount, 1500);
  assert.equal(parseProductInput({ sku: "P", name: "Phone", sellingAmount: 1000 }).error, "invalid_sku");
  assert.equal(parseProductInput({ sku: "PHONE-02", name: "Phone", costAmount: 100.5, sellingAmount: 200 }).error, "amounts_must_be_whole_ugx");
});

test("Opoint readiness contract includes ledger guards and required product tables", () => {
  assert.ok(REQUIRED_TABLES.includes("companies"));
  assert.ok(REQUIRED_TABLES.includes("payment_intents"));
  assert.ok(REQUIRED_GUARDS.includes("trg_journal_post_balance_guard"));
});

test("protected endpoints reject missing bearer tokens before data access", async () => {
  let touched = false;
  const env = {
    DB: { prepare() { touched = true; throw new Error("database should not be queried"); } },
  };
  const response = await worker.fetch(new Request("https://opoint-staging.invalid/v1/me"), env);
  assert.equal(response.status, 401);
  assert.equal(touched, false);
});

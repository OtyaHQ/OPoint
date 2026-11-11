import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyName, normalizeSlug, isUGXAmount, maskPhone, maskEmail } from "../src/index.mjs";

test("normalizes company names and slugs", () => {
  assert.equal(normalizeCompanyName("  Otya Holdings   Limited "), "Otya Holdings Limited");
  assert.equal(normalizeSlug("Mbirizi Shop & Electronics"), "mbirizi-shop-electronics");
});

test("accepts only safe non-negative integer UGX amounts", () => {
  assert.equal(isUGXAmount(0), true);
  assert.equal(isUGXAmount(125000), true);
  assert.equal(isUGXAmount(-1), false);
  assert.equal(isUGXAmount(1.5), false);
  assert.equal(isUGXAmount(Number.MAX_SAFE_INTEGER + 1), false);
});

test("masks phone and email values", () => {
  assert.equal(maskPhone("+256772123456"), "••••••3456");
  assert.equal(maskPhone("123"), "****");
  assert.equal(maskEmail("peter@example.com"), "p***@example.com");
  assert.equal(maskEmail("not-an-email"), null);
});

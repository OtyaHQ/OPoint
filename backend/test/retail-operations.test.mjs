import test from "node:test";
import assert from "node:assert/strict";
import { validateRetailSaleRequest, calculateCashDifference } from "../src/retail-operations.mjs";

test("retail sale accepts cash only and requires an active cash-session reference", () => {
  const accepted = validateRetailSaleRequest({
    paymentMethod: "CASH",
    cashSessionId: "cash-session-001",
    items: [{ productId: "product-001", quantity: 2 }],
  });
  assert.deepEqual(accepted, {
    value: {
      cashSessionId: "cash-session-001",
      items: [{ productId: "product-001", quantity: 2 }],
      customerId: null,
    },
  });
});

test("retail sale rejects external payment methods instead of pretending they succeeded", () => {
  for (const method of ["MTN_MOMO", "AIRTEL_MONEY", "QUICKTELLER", "INTERSWITCH", "CARD", ""]) {
    const result = validateRetailSaleRequest({
      paymentMethod: method,
      cashSessionId: "cash-session-001",
      items: [{ productId: "product-001", quantity: 1 }],
    });
    assert.equal(result.error, "payment_method_not_enabled", method);
    assert.equal(result.status, 422);
  }
});

test("retail sale requires one to forty unique product lines and positive integer quantities", () => {
  const base = { paymentMethod: "CASH", cashSessionId: "cash-session-001" };
  assert.equal(validateRetailSaleRequest({ ...base, items: [] }).error, "sale_requires_1_to_40_lines");
  assert.equal(validateRetailSaleRequest({ ...base, items: [{ productId: "p1", quantity: 1 }, { productId: "p1", quantity: 2 }] }).error, "invalid_sale_items");
  assert.equal(validateRetailSaleRequest({ ...base, items: [{ productId: "p1", quantity: 0 }] }).error, "invalid_sale_items");
  assert.equal(validateRetailSaleRequest({ ...base, items: [{ productId: "p1", quantity: 1.5 }] }).error, "invalid_sale_items");
  assert.equal(validateRetailSaleRequest({ ...base, items: [{ productId: "p1", quantity: 10001 }] }).error, "invalid_sale_items");
});

test("cash session difference is counted cash minus expected cash in whole UGX", () => {
  assert.deepEqual(calculateCashDifference(100000, 95000), { ok: true, difference: -5000 });
  assert.deepEqual(calculateCashDifference(100000, 105000), { ok: true, difference: 5000 });
  assert.deepEqual(calculateCashDifference(100000, 100000), { ok: true, difference: 0 });
  assert.equal(calculateCashDifference(100000.5, 100000).error, "cash_amounts_must_be_whole_ugx");
  assert.equal(calculateCashDifference(100000, -1).error, "cash_amounts_must_be_whole_ugx");
});

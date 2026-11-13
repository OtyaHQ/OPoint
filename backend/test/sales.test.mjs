import test from "node:test";
import assert from "node:assert/strict";
import { calculateSaleAmounts } from "../src/sales.mjs";

test("calculates sale totals in integer UGX and preserves line snapshots", () => {
  const result = calculateSaleAmounts([
    { productId: "p1", quantity: 2, unitPriceAmount: 15000, unitCostAmount: 9000, discountAmount: 1000 },
    { productId: "p2", quantity: 1, unitPriceAmount: 5000, unitCostAmount: 3000 },
  ], 1800);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    currency: "UGX",
    lines: [
      { productId: "p1", quantity: 2, unitPriceAmount: 15000, unitCostAmount: 9000, discountAmount: 1000, lineTotalAmount: 29000 },
      { productId: "p2", quantity: 1, unitPriceAmount: 5000, unitCostAmount: 3000, discountAmount: 0, lineTotalAmount: 5000 },
    ],
    subtotalAmount: 35000,
    discountAmount: 1000,
    taxAmount: 1800,
    totalAmount: 35800,
    costAmount: 21000,
  });
});

test("rejects float, negative, zero and excessive quantities", () => {
  for (const quantity of [0, -1, 1.5, 100001]) {
    assert.equal(calculateSaleAmounts([
      { productId: "p1", quantity, unitPriceAmount: 1000, unitCostAmount: 500 },
    ]).ok, false);
  }
});

test("rejects discounts greater than the line gross", () => {
  assert.equal(calculateSaleAmounts([
    { productId: "p1", quantity: 1, unitPriceAmount: 1000, unitCostAmount: 500, discountAmount: 1001 },
  ]).error, "line_discount_exceeds_gross");
});

test("rejects overflow and non-integer tax", () => {
  assert.equal(calculateSaleAmounts([
    { productId: "p1", quantity: 100000, unitPriceAmount: 1000000000, unitCostAmount: 1 },
  ]).error, "sale_line_total_out_of_range");
  assert.equal(calculateSaleAmounts([
    { productId: "p1", quantity: 1, unitPriceAmount: 1000, unitCostAmount: 500 },
  ], 0.5).error, "tax_must_be_whole_ugx");
});

test("requires one to one hundred sale lines and a product identifier", () => {
  assert.equal(calculateSaleAmounts([]).error, "sale_requires_1_to_100_lines");
  assert.equal(calculateSaleAmounts([
    { quantity: 1, unitPriceAmount: 1000, unitCostAmount: 500 },
  ]).error, "product_id_required");
});

import test from "node:test";
import assert from "node:assert/strict";
import { saleRequestFingerprint } from "../src/sale-fingerprint.mjs";

test("sale fingerprint is stable when item order changes", async () => {
  const first = await saleRequestFingerprint("CASH", [
    { productId: "product-b", quantity: 2 },
    { productId: "product-a", quantity: 1 }
  ]);
  const reordered = await saleRequestFingerprint("CASH", [
    { productId: "product-a", quantity: 1 },
    { productId: "product-b", quantity: 2 }
  ]);
  assert.equal(first, reordered);
});

test("sale fingerprint changes when payment method changes", async () => {
  const cash = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }]);
  const mobileMoney = await saleRequestFingerprint("MOBILE_MONEY", [{ productId: "p1", quantity: 1 }]);
  assert.notEqual(cash, mobileMoney);
});

test("sale fingerprint changes when product or quantity changes", async () => {
  const baseline = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }]);
  const changedProduct = await saleRequestFingerprint("CASH", [{ productId: "p2", quantity: 1 }]);
  const changedQuantity = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 2 }]);
  assert.notEqual(baseline, changedProduct);
  assert.notEqual(baseline, changedQuantity);
});
test("sale fingerprint changes when the branch changes", async () => {
  const main = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }], "branch-main");
  const second = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }], "branch-second");
  assert.notEqual(main, second);
});

test("legacy company-wide sale fingerprints remain stable when no branch is supplied", async () => {
  const withoutBranch = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }]);
  const explicitNull = await saleRequestFingerprint("CASH", [{ productId: "p1", quantity: 1 }], null);
  assert.equal(withoutBranch, explicitNull);
});

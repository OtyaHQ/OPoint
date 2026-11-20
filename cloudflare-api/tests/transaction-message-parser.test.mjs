import test from "node:test";
import assert from "node:assert/strict";
import { parseTransactionMessage } from "../src/transaction-message-parser.mjs";

test("extracts Airtel cash-out as an unverified candidate", () => {
  const result = parseTransactionMessage(
    "Airtel Money: You have withdrawn UGX 50,000. Transaction Ref: AM12345678. Transaction successful.",
    "AIRTEL_MONEY"
  );
  assert.equal(result.amountUgx, 50000);
  assert.equal(result.providerReference, "AM12345678");
  assert.equal(result.transactionType, "CASH_OUT");
  assert.equal(result.sourceStatusClaim, "SUCCESS_REPORTED");
  assert.equal(result.providerConfirmed, false);
  assert.equal(result.verificationLevel, "UNVERIFIED");
});

test("extracts an MTN received-money candidate", () => {
  const result = parseTransactionMessage(
    "MTN MoMo: You have received UGX 25,000. Txn ID: MTN987654321. Successful.",
    "MTN_MOMO"
  );
  assert.equal(result.amountUgx, 25000);
  assert.equal(result.providerReference, "MTN987654321");
  assert.equal(result.transactionType, "CASH_IN");
});

test("extracts a Quickteller bill payment candidate", () => {
  const result = parseTransactionMessage(
    "Quickteller: Bill payment of UGX 18,000 completed. Reference: QT23456789.",
    "INTERSWITCH_QUICKTELLER"
  );
  assert.equal(result.amountUgx, 18000);
  assert.equal(result.providerReference, "QT23456789");
  assert.equal(result.transactionType, "BILL_PAYMENT");
});

test("does not invent an amount or reference", () => {
  const result = parseTransactionMessage(
    "MTN MoMo transaction was successful. Thank you.",
    "MTN_MOMO"
  );
  assert.equal(result.amountUgx, null);
  assert.equal(result.providerReference, null);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.providerConfirmed, false);
});

test("rejects unknown providers and oversized input", () => {
  assert.throws(() => parseTransactionMessage("A message longer than eight characters", "OTHER"));
  assert.throws(() => parseTransactionMessage("x".repeat(8001), "AIRTEL_MONEY"));
});

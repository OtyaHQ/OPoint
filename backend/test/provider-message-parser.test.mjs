import test from "node:test";
import assert from "node:assert/strict";
import { parseProviderMessage } from "../src/provider-message-parser.mjs";

test("extracts candidate data from explicitly shared synthetic Airtel message text", () => {
  const parsed = parseProviderMessage({
    providerCode: "AIRTEL_MONEY",
    messageText: "Airtel Money cash out successful. Transaction ID: AIR-TEST-12345. Amount: UGX 150,000.",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fields.providerReferenceCandidate, "AIR-TEST-12345");
  assert.equal(parsed.fields.amountUGXCandidate, 150000);
  assert.equal(parsed.fields.transactionKindCandidate, "CASH_OUT");
  assert.equal(parsed.fields.messageClaimedStatus, "SUCCESS_CLAIMED_BY_MESSAGE");
  assert.equal(parsed.providerStatus, "UNKNOWN");
  assert.equal("rawMessageText" in parsed, false);
});

test("does not promote message wording to provider-confirmed transaction status", () => {
  const parsed = parseProviderMessage({
    providerCode: "MTN_MOMO",
    messageText: "Transaction successful. Ref: MTN-TEST-12345. Amount: 20,000 UGX. Cash in.",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.providerStatus, "UNKNOWN");
  assert.equal(parsed.fields.messageClaimedStatus, "SUCCESS_CLAIMED_BY_MESSAGE");
});

test("keeps ambiguous or partial messages in manual review", () => {
  const parsed = parseProviderMessage({
    providerCode: "INTERSWITCH_QUICKTELLER",
    messageText: "Your transaction was successful. Thank you.",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "NEEDS_REVIEW");
  assert.equal(parsed.fields.providerReferenceCandidate, null);
  assert.equal(parsed.fields.amountUGXCandidate, null);
});

test("rejects unsupported providers and oversized messages", () => {
  assert.equal(parseProviderMessage({ providerCode: "OTHER", messageText: "ref ABCDE" }).error, "unsupported_provider");
  assert.equal(parseProviderMessage({ providerCode: "AIRTEL_MONEY", messageText: "x".repeat(10001) }).error, "message_text_invalid");
});

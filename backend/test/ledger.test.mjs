import test from "node:test";
import assert from "node:assert/strict";
import { validateJournalLines } from "../src/ledger.mjs";

test("accepts balanced integer UGX journals", () => {
  const result = validateJournalLines([
    { ledgerAccountId: "cash", debitAmount: 125000, creditAmount: 0 },
    { ledgerAccountId: "sales", debitAmount: 0, creditAmount: 125000 },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.value.debitTotal, 125000);
  assert.equal(result.value.creditTotal, 125000);
});

test("rejects unbalanced journal", () => {
  assert.equal(validateJournalLines([
    { ledgerAccountId: "cash", debitAmount: 1000 },
    { ledgerAccountId: "sales", creditAmount: 999 },
  ]).error, "journal_is_not_balanced");
});

test("rejects lines with both debit and credit or neither", () => {
  for (const line of [
    { ledgerAccountId: "cash", debitAmount: 100, creditAmount: 100 },
    { ledgerAccountId: "cash", debitAmount: 0, creditAmount: 0 },
  ]) {
    assert.equal(validateJournalLines([line, { ledgerAccountId: "x", creditAmount: 100 }]).error,
      "each_line_must_have_one_positive_side");
  }
});

test("rejects floats, negative and out-of-range UGX", () => {
  for (const amount of [1.5, -1, 1_000_000_000_001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateJournalLines([
      { ledgerAccountId: "cash", debitAmount: amount },
      { ledgerAccountId: "sales", creditAmount: amount },
    ]).ok, false);
  }
});

test("requires two to one hundred lines and account references", () => {
  assert.equal(validateJournalLines([]).error, "journal_requires_2_to_100_lines");
  assert.equal(validateJournalLines([
    { debitAmount: 10 }, { ledgerAccountId: "sales", creditAmount: 10 },
  ]).error, "ledger_account_required");
});

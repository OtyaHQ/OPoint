import test from "node:test";
import assert from "node:assert/strict";
import { validateJournalLines, postJournalEntry } from "../src/ledger.mjs";

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

function mockDb({ prior = null, accounts = ["cash", "sales"], sourceConflict = null } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("idempotency_key")) return prior;
          if (sql.includes("source_type") && sql.includes("source_id")) return sourceConflict;
          return null;
        },
        async all() {
          if (sql.includes("FROM ledger_accounts")) return { results: accounts.map(id => ({ id })) };
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(statements) { calls.push(statements); return []; },
  };
  return db;
}

test("posting primitive writes header, lines and posted transition in one D1 batch", async () => {
  const db = mockDb();
  const result = await postJournalEntry(db, {
    companyId: "company-1", actorId: "owner-1", sourceType: "SALE",
    sourceId: "sale-1", idempotencyKey: "sale-1-posting-0001",
    description: "Sale receipt", lines: [
      { ledgerAccountId: "cash", debitAmount: 125000 },
      { ledgerAccountId: "sales", creditAmount: 125000 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.status, "POSTED");
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].length, 4);
  assert.match(db.calls[0][0].sql, /INSERT INTO journal_entries/);
  assert.match(db.calls[0][1].sql, /INSERT INTO journal_lines/);
  assert.match(db.calls[0][3].sql, /UPDATE journal_entries SET status='POSTED'/);
});

test("posting primitive safely replays the same idempotent source", async () => {
  const db = mockDb({ prior: {
    id: "journal-1", entry_number: "JRN-1", status: "POSTED",
    source_type: "SALE", source_id: "sale-1",
  } });
  const result = await postJournalEntry(db, {
    companyId: "company-1", actorId: "owner-1", sourceType: "SALE",
    sourceId: "sale-1", idempotencyKey: "sale-1-posting-0001",
    description: "Sale receipt", lines: [
      { ledgerAccountId: "cash", debitAmount: 125000 },
      { ledgerAccountId: "sales", creditAmount: 125000 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.replay, true);
  assert.equal(db.calls.length, 0);
});

test("posting primitive refuses accounts outside the company or inactive accounts", async () => {
  const db = mockDb({ accounts: ["cash"] });
  const result = await postJournalEntry(db, {
    companyId: "company-1", actorId: "owner-1", sourceType: "SALE",
    sourceId: "sale-1", idempotencyKey: "sale-1-posting-0001",
    description: "Sale receipt", lines: [
      { ledgerAccountId: "cash", debitAmount: 125000 },
      { ledgerAccountId: "sales", creditAmount: 125000 },
    ],
  });
  assert.equal(result.error, "journal_contains_unknown_or_inactive_account");
  assert.equal(db.calls.length, 0);
});

// Internal accounting primitive. This module is intentionally not exposed as an HTTP route.
// Callers must keep the product write gate disabled until financial approval gates are satisfied.

const MAX_UGX = 1_000_000_000_000;
const cleanText = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, max)
  : "";

export function validateJournalLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 100) {
    return { ok: false, error: "journal_requires_2_to_100_lines" };
  }
  let debitTotal = 0;
  let creditTotal = 0;
  const normalized = [];
  for (const line of lines) {
    const ledgerAccountId = cleanText(line?.ledgerAccountId, 80);
    const debitAmount = line?.debitAmount ?? 0;
    const creditAmount = line?.creditAmount ?? 0;
    if (!ledgerAccountId) return { ok: false, error: "ledger_account_required" };
    if (!Number.isSafeInteger(debitAmount) || !Number.isSafeInteger(creditAmount)
      || debitAmount < 0 || creditAmount < 0 || debitAmount > MAX_UGX || creditAmount > MAX_UGX) {
      return { ok: false, error: "journal_amounts_must_be_whole_ugx" };
    }
    if ((debitAmount > 0) === (creditAmount > 0)) {
      return { ok: false, error: "each_line_must_have_one_positive_side" };
    }
    debitTotal += debitAmount;
    creditTotal += creditAmount;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) {
      return { ok: false, error: "journal_total_out_of_range" };
    }
    normalized.push({
      ledgerAccountId,
      debitAmount,
      creditAmount,
      memo: cleanText(line?.memo, 240) || null,
    });
  }
  if (debitTotal <= 0 || debitTotal !== creditTotal) {
    return { ok: false, error: "journal_is_not_balanced" };
  }
  return { ok: true, value: { lines: normalized, debitTotal, creditTotal } };
}

export async function postJournalEntry(db, input) {
  const companyId = cleanText(input?.companyId, 80);
  const actorId = cleanText(input?.actorId, 160);
  const sourceType = cleanText(input?.sourceType, 40).toUpperCase();
  const sourceId = cleanText(input?.sourceId, 80);
  const idempotencyKey = cleanText(input?.idempotencyKey, 128);
  const description = cleanText(input?.description, 240);
  if (!companyId || !actorId || !sourceType || !sourceId || !description
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return { ok: false, status: 400, error: "journal_metadata_or_idempotency_key_invalid" };
  }

  const validated = validateJournalLines(input.lines);
  if (!validated.ok) return { ok: false, status: 400, error: validated.error };
  const { lines, debitTotal } = validated.value;

  const prior = await db.prepare(
    "SELECT id,entry_number,status,source_type,source_id FROM journal_entries WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1"
  ).bind(companyId, idempotencyKey).first();
  if (prior) {
    if (prior.source_type !== sourceType || prior.source_id !== sourceId) {
      return { ok: false, status: 409, error: "idempotency_key_reused_for_another_source" };
    }
    if (prior.status === "POSTED") return { ok: true, replay: true, entry: prior };
    return { ok: false, status: 409, error: "journal_idempotency_record_not_posted" };
  }

  const accountIds = [...new Set(lines.map(line => line.ledgerAccountId))];
  const placeholders = accountIds.map((_, index) => `?${index + 2}`).join(",");
  const accounts = await db.prepare(
    `SELECT id FROM ledger_accounts WHERE company_id=?1 AND status='ACTIVE' AND currency='UGX' AND id IN (${placeholders})`
  ).bind(companyId, ...accountIds).all();
  const available = new Set((accounts.results || []).map(row => row.id));
  if (available.size !== accountIds.length) {
    return { ok: false, status: 400, error: "journal_contains_unknown_or_inactive_account" };
  }

  const entryId = crypto.randomUUID();
  const entryNumber = `JRN-${entryId.slice(0, 12).toUpperCase()}`;
  const statements = [
    db.prepare(
      "INSERT INTO journal_entries (id,company_id,entry_number,source_type,source_id,status,currency,description,idempotency_key,created_by) VALUES (?1,?2,?3,?4,?5,'DRAFT','UGX',?6,?7,?8)"
    ).bind(entryId, companyId, entryNumber, sourceType, sourceId, description, idempotencyKey, actorId),
    ...lines.map((line, index) => db.prepare(
      "INSERT INTO journal_lines (id,company_id,journal_entry_id,line_number,ledger_account_id,debit_amount,credit_amount,memo) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
    ).bind(crypto.randomUUID(), companyId, entryId, index + 1, line.ledgerAccountId, line.debitAmount, line.creditAmount, line.memo)),
    db.prepare(
      "UPDATE journal_entries SET status='POSTED',posted_by=?1,posted_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND status='DRAFT'"
    ).bind(actorId, companyId, entryId),
  ];

  try {
    // D1 batch executes the statements atomically. The database posting trigger is a
    // second line of defence and rejects an unbalanced transition to POSTED.
    await db.batch(statements);
    return {
      ok: true,
      replay: false,
      entry: { id: entryId, entryNumber, status: "POSTED", sourceType, sourceId, debitTotalUGX: debitTotal },
    };
  } catch (error) {
    // A concurrent duplicate is resolved by re-reading the idempotency record.
    const duplicate = await db.prepare(
      "SELECT id,entry_number,status,source_type,source_id FROM journal_entries WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1"
    ).bind(companyId, idempotencyKey).first();
    if (duplicate?.status === "POSTED" && duplicate.source_type === sourceType && duplicate.source_id === sourceId) {
      return { ok: true, replay: true, entry: duplicate };
    }
    const sourceConflict = await db.prepare(
      "SELECT id FROM journal_entries WHERE company_id=?1 AND source_type=?2 AND source_id=?3 LIMIT 1"
    ).bind(companyId, sourceType, sourceId).first();
    if (sourceConflict) return { ok: false, status: 409, error: "source_already_has_journal_entry" };
    return { ok: false, status: 409, error: "journal_posting_conflict" };
  }
}

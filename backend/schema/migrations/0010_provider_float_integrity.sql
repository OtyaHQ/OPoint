-- Separate provider float ledgers from operator cash drawers and guard float solvency.
CREATE TRIGGER IF NOT EXISTS cash_provider_float_insert_guard
BEFORE INSERT ON cash_accounts
WHEN NEW.account_type = 'PROVIDER_FLOAT'
BEGIN
  SELECT CASE WHEN NEW.work_area <> 'MOBILE_MONEY'
    OR NEW.provider_code NOT IN ('AIRTEL_MONEY','MTN_MOMO')
    THEN RAISE(ABORT, 'PROVIDER_FLOAT_REQUIRES_MATCHED_MOBILE_MONEY_PROVIDER') END;
END;

CREATE TRIGGER IF NOT EXISTS cash_provider_float_update_guard
BEFORE UPDATE OF account_type,work_area,provider_code ON cash_accounts
WHEN NEW.account_type = 'PROVIDER_FLOAT'
BEGIN
  SELECT CASE WHEN NEW.work_area <> 'MOBILE_MONEY'
    OR NEW.provider_code NOT IN ('AIRTEL_MONEY','MTN_MOMO')
    THEN RAISE(ABORT, 'PROVIDER_FLOAT_REQUIRES_MATCHED_MOBILE_MONEY_PROVIDER') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_outlet_float_account_guard
BEFORE INSERT ON provider_outlet_accounts
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM cash_accounts ca
      JOIN provider_relationships pr
        ON pr.company_id = ca.company_id
       AND pr.id = NEW.provider_relationship_id
     WHERE ca.company_id = NEW.company_id
       AND ca.id = NEW.cash_account_id
       AND ca.branch_id = NEW.branch_id
       AND ca.account_type = 'PROVIDER_FLOAT'
       AND ca.work_area = 'MOBILE_MONEY'
       AND ca.provider_code = pr.provider_code
       AND pr.provider_code IN ('AIRTEL_MONEY','MTN_MOMO')
  ) THEN RAISE(ABORT, 'PROVIDER_OUTLET_REQUIRES_MATCHED_FLOAT_ACCOUNT') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_outlet_float_account_update_guard
BEFORE UPDATE OF cash_account_id,branch_id,provider_relationship_id ON provider_outlet_accounts
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM cash_accounts ca
      JOIN provider_relationships pr
        ON pr.company_id = ca.company_id
       AND pr.id = NEW.provider_relationship_id
     WHERE ca.company_id = NEW.company_id
       AND ca.id = NEW.cash_account_id
       AND ca.branch_id = NEW.branch_id
       AND ca.account_type = 'PROVIDER_FLOAT'
       AND ca.work_area = 'MOBILE_MONEY'
       AND ca.provider_code = pr.provider_code
       AND pr.provider_code IN ('AIRTEL_MONEY','MTN_MOMO')
  ) THEN RAISE(ABORT, 'PROVIDER_OUTLET_REQUIRES_MATCHED_FLOAT_ACCOUNT') END;
END;

-- Check every provider float asset at the moment a journal entry is posted.
-- D1 serializes writes; this prevents two concurrent deposits from overspending float.
CREATE TRIGGER IF NOT EXISTS provider_float_nonnegative_balance_guard
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM journal_lines current_line
      JOIN cash_accounts float_account
        ON float_account.company_id = current_line.company_id
       AND float_account.ledger_account_id = current_line.ledger_account_id
       AND float_account.account_type = 'PROVIDER_FLOAT'
     WHERE current_line.company_id = NEW.company_id
       AND current_line.journal_entry_id = NEW.id
       AND (
         COALESCE((
           SELECT SUM(posted_line.debit_amount - posted_line.credit_amount)
             FROM journal_lines posted_line
             JOIN journal_entries posted_entry
               ON posted_entry.company_id = posted_line.company_id
              AND posted_entry.id = posted_line.journal_entry_id
            WHERE posted_line.company_id = NEW.company_id
              AND posted_line.ledger_account_id = current_line.ledger_account_id
              AND posted_entry.status = 'POSTED'
         ), 0)
         + COALESCE((
           SELECT SUM(new_line.debit_amount - new_line.credit_amount)
             FROM journal_lines new_line
            WHERE new_line.company_id = NEW.company_id
              AND new_line.journal_entry_id = NEW.id
              AND new_line.ledger_account_id = current_line.ledger_account_id
         ), 0)
       ) < 0
  ) THEN RAISE(ABORT, 'PROVIDER_FLOAT_BALANCE_WOULD_BE_NEGATIVE') END;
END;

-- Checksum covers the migration body above and excludes the ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0010_provider_float_integrity', '9ec442c43b49d6ae28578c5cef5a0a19624ba84a4677e8fe698594a4be6b4f05', CURRENT_TIMESTAMP);

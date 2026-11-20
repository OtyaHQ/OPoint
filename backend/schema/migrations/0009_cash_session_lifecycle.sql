-- OtyaPoint cash-controlled retail sales and cash-session lifecycle.
-- Forward-only. Apply to the new OtyaPoint production D1 after the schema baseline.
-- Does not create business rows or enable external provider execution.

ALTER TABLE sales ADD COLUMN cash_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_cash_session
  ON sales(company_id, cash_session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_unresolved_account
  ON cash_sessions(company_id, cash_account_id)
  WHERE status IN ('OPEN','SUBMITTED','DISPUTED');

CREATE TRIGGER IF NOT EXISTS sale_requires_open_retail_cash_session
BEFORE INSERT ON sales
WHEN NEW.status = 'COMPLETED'
 AND NOT EXISTS (
   SELECT 1
     FROM cash_sessions cs
     JOIN cash_accounts ca
       ON ca.company_id = cs.company_id
      AND ca.id = cs.cash_account_id
    WHERE cs.company_id = NEW.company_id
      AND cs.id = NEW.cash_session_id
      AND cs.branch_id = NEW.branch_id
      AND cs.status = 'OPEN'
      AND ca.status = 'ACTIVE'
      AND ca.account_type = 'CASH_DRAWER'
      AND ca.work_area = 'RETAIL'
 )
BEGIN
  SELECT RAISE(ABORT, 'sale_requires_open_retail_cash_session');
END;

CREATE TRIGGER IF NOT EXISTS cash_session_status_transition_guard
BEFORE UPDATE OF status ON cash_sessions
WHEN NEW.status <> OLD.status
 AND NOT (
   (OLD.status = 'OPEN' AND NEW.status = 'SUBMITTED')
   OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('CLOSED','DISPUTED'))
   OR (OLD.status = 'DISPUTED' AND NEW.status = 'CLOSED')
 )
BEGIN
  SELECT RAISE(ABORT, 'cash_session_status_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS cash_session_close_metadata_guard
BEFORE UPDATE OF status ON cash_sessions
WHEN NEW.status = 'CLOSED'
 AND (
   NEW.counted_closing_amount IS NULL
   OR NEW.difference_amount IS NULL
   OR NEW.closed_by IS NULL
   OR NEW.closed_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'cash_session_close_metadata_required');
END;

-- Checksum covers the migration body above and excludes the ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0009_cash_session_lifecycle', '9969372fbf063beec9cecd0dc20681cf9ba36b93978ea0ac8c4d31a8af542504', CURRENT_TIMESTAMP);

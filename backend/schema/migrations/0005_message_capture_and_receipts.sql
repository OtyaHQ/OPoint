-- Otya Enterprise provider-message capture and receipt issuance.
-- Additive staging migration. The system records and evidences transactions already completed
-- in provider-approved channels; it never initiates or executes customer/provider payments.
-- Deliberately does not add READ_SMS, RECEIVE_SMS, notification-listener or provider-login secrets.

CREATE TABLE IF NOT EXISTS provider_message_captures (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT,
  provider_relationship_id TEXT NOT NULL,
  provider_outlet_account_id TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('USER_SHARED_MESSAGE','SCREENSHOT_UPLOAD','PROVIDER_REPORT')),
  sender_label TEXT,
  source_app_label TEXT,
  message_received_at TEXT,
  message_fingerprint TEXT NOT NULL,
  parsed_fields_json TEXT,
  parser_key TEXT,
  parser_version TEXT,
  parse_status TEXT NOT NULL DEFAULT 'CAPTURED'
    CHECK (parse_status IN ('CAPTURED','PARSED','NEEDS_REVIEW','ACCEPTED','REJECTED','DUPLICATE')),
  evidence_file_id TEXT REFERENCES stored_files(id) ON DELETE RESTRICT,
  received_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_relationship_id) REFERENCES provider_relationships(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, message_fingerprint),
  CHECK (source_kind <> 'SCREENSHOT_UPLOAD' OR evidence_file_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_provider_message_captures_review
  ON provider_message_captures(company_id, parse_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_message_captures_account
  ON provider_message_captures(company_id, provider_outlet_account_id, message_received_at DESC);

-- Raw SMS message bodies are intentionally not retained in D1. The client shares a specific
-- message or screenshot, filters it locally and submits only selected source metadata,
-- a one-way fingerprint and parsed candidate fields. Original evidence may be stored privately
-- in R2 only when the employee explicitly attaches it and access is authorized.

CREATE TABLE IF NOT EXISTS issued_receipts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  receipt_kind TEXT NOT NULL CHECK (receipt_kind IN ('RETAIL_SALE','AGENCY_SERVICE')),
  source_type TEXT NOT NULL CHECK (source_type IN ('SALE','PROVIDER_TRANSACTION_RECORD')),
  source_id TEXT NOT NULL,
  issue_status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (issue_status IN ('ISSUED','VOIDED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  customer_display_name TEXT,
  customer_contact_last4 TEXT CHECK (customer_contact_last4 IS NULL OR length(customer_contact_last4) = 4),
  evidence_description TEXT,
  receipt_snapshot_json TEXT NOT NULL,
  stored_file_id TEXT REFERENCES stored_files(id) ON DELETE RESTRICT,
  verification_token_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by TEXT,
  voided_at TEXT,
  void_reason TEXT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, receipt_number),
  UNIQUE(company_id, source_type, source_id),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(verification_token_hash),
  CHECK (
    (issue_status = 'ISSUED' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR
    (issue_status = 'VOIDED' AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND length(trim(void_reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_issued_receipts_branch_date
  ON issued_receipts(company_id, branch_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_receipts_source
  ON issued_receipts(company_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS receipt_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  receipt_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED','REPRINTED','EMAILED','DOWNLOADED','VOIDED')),
  actor_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, receipt_id) REFERENCES issued_receipts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_receipt_events_receipt
  ON receipt_events(company_id, receipt_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS issued_receipts_source_guard
BEFORE INSERT ON issued_receipts
BEGIN
  SELECT CASE WHEN NEW.source_type = 'SALE' AND NOT EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = NEW.source_id
       AND s.company_id = NEW.company_id
       AND s.branch_id = NEW.branch_id
       AND s.status = 'COMPLETED'
       AND s.total_amount = NEW.total_amount
  ) THEN RAISE(ABORT, 'RETAIL_RECEIPT_REQUIRES_COMPLETED_SALE') END;
  SELECT CASE WHEN NEW.source_type = 'PROVIDER_TRANSACTION_RECORD' AND NOT EXISTS (
    SELECT 1 FROM provider_transaction_records t
     WHERE t.id = NEW.source_id
       AND t.company_id = NEW.company_id
       AND t.branch_id = NEW.branch_id
       AND t.amount = NEW.total_amount
  ) THEN RAISE(ABORT, 'AGENCY_RECEIPT_REQUIRES_MATCHING_PROVIDER_RECORD') END;
  SELECT CASE WHEN NEW.receipt_kind = 'RETAIL_SALE' AND NEW.source_type <> 'SALE'
    THEN RAISE(ABORT, 'RETAIL_RECEIPT_SOURCE_MISMATCH') END;
  SELECT CASE WHEN NEW.receipt_kind = 'AGENCY_SERVICE' AND NEW.source_type <> 'PROVIDER_TRANSACTION_RECORD'
    THEN RAISE(ABORT, 'AGENCY_RECEIPT_SOURCE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS issued_receipts_no_delete
BEFORE DELETE ON issued_receipts
BEGIN
  SELECT RAISE(ABORT, 'ISSUED_RECEIPTS_ARE_RETAINED');
END;

CREATE TRIGGER IF NOT EXISTS issued_receipt_events_no_update
BEFORE UPDATE ON receipt_events
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_EVENTS_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS issued_receipt_events_no_delete
BEFORE DELETE ON receipt_events
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_EVENTS_APPEND_ONLY');
END;

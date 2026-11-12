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
  provider_status_at_issue TEXT CHECK (provider_status_at_issue IS NULL OR provider_status_at_issue IN ('NOT_CHECKED','PENDING','SUCCEEDED','FAILED','UNKNOWN','REVERSED')),
  evidence_level_at_issue TEXT CHECK (evidence_level_at_issue IS NULL OR evidence_level_at_issue IN ('STAFF_REPORTED','RECEIPT_REVIEWED','STATEMENT_MATCHED','PROVIDER_FEED')),
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
    (source_type = 'SALE' AND provider_status_at_issue IS NULL AND evidence_level_at_issue IS NULL)
    OR
    (source_type = 'PROVIDER_TRANSACTION_RECORD' AND provider_status_at_issue IS NOT NULL AND evidence_level_at_issue IS NOT NULL)
  ),
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
       AND t.provider_status = NEW.provider_status_at_issue
       AND t.evidence_level = NEW.evidence_level_at_issue
  ) THEN RAISE(ABORT, 'AGENCY_RECEIPT_REQUIRES_MATCHING_PROVIDER_RECORD_AND_EVIDENCE') END;
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_company_account_per_kind
  ON provider_outlet_accounts(company_id, provider_relationship_id, account_kind)
  WHERE scope_type = 'COMPANY';
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_outlet_account_per_branch_kind
  ON provider_outlet_accounts(company_id, provider_relationship_id, branch_id, account_kind)
  WHERE scope_type = 'OUTLET';

CREATE TRIGGER IF NOT EXISTS provider_operator_account_relationship_guard
BEFORE INSERT ON provider_operator_profiles
WHEN NEW.provider_outlet_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM provider_outlet_accounts a
     WHERE a.id = NEW.provider_outlet_account_id
       AND a.company_id = NEW.company_id
       AND a.provider_relationship_id = NEW.provider_relationship_id
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_RELATIONSHIP_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS company_sim_asset_type_guard
BEFORE INSERT ON company_sim_details
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM company_assets a
     WHERE a.id = NEW.asset_id
       AND a.company_id = NEW.company_id
       AND a.asset_type = 'SIM_CARD'
  ) THEN RAISE(ABORT, 'SIM_DETAILS_REQUIRE_COMPANY_SIM_ASSET') END;
END;

CREATE TRIGGER IF NOT EXISTS issued_receipts_void_only
BEFORE UPDATE ON issued_receipts
WHEN NOT (
  OLD.issue_status = 'ISSUED'
  AND NEW.issue_status = 'VOIDED'
  AND NEW.voided_by IS NOT NULL
  AND NEW.voided_at IS NOT NULL
  AND length(trim(NEW.void_reason)) > 0
  AND NEW.id IS OLD.id
  AND NEW.company_id IS OLD.company_id
  AND NEW.branch_id IS OLD.branch_id
  AND NEW.receipt_number IS OLD.receipt_number
  AND NEW.receipt_kind IS OLD.receipt_kind
  AND NEW.source_type IS OLD.source_type
  AND NEW.source_id IS OLD.source_id
  AND NEW.currency IS OLD.currency
  AND NEW.total_amount IS OLD.total_amount
  AND NEW.provider_status_at_issue IS OLD.provider_status_at_issue
  AND NEW.evidence_level_at_issue IS OLD.evidence_level_at_issue
  AND NEW.customer_display_name IS OLD.customer_display_name
  AND NEW.customer_contact_last4 IS OLD.customer_contact_last4
  AND NEW.evidence_description IS OLD.evidence_description
  AND NEW.receipt_snapshot_json IS OLD.receipt_snapshot_json
  AND NEW.stored_file_id IS OLD.stored_file_id
  AND NEW.verification_token_hash IS OLD.verification_token_hash
  AND NEW.idempotency_key IS OLD.idempotency_key
  AND NEW.issued_by IS OLD.issued_by
  AND NEW.issued_at IS OLD.issued_at
)
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_IMMUTABLE_EXCEPT_ONE_WAY_VOID');
END;

CREATE TRIGGER IF NOT EXISTS issued_receipts_record_issue
AFTER INSERT ON issued_receipts
BEGIN
  INSERT INTO receipt_events(id,company_id,receipt_id,event_type,actor_id,reason)
  VALUES (lower(hex(randomblob(16))),NEW.company_id,NEW.id,'ISSUED',NEW.issued_by,'Receipt issued');
END;

CREATE TRIGGER IF NOT EXISTS issued_receipts_record_void
AFTER UPDATE ON issued_receipts
WHEN OLD.issue_status = 'ISSUED' AND NEW.issue_status = 'VOIDED'
BEGIN
  INSERT INTO receipt_events(id,company_id,receipt_id,event_type,actor_id,reason)
  VALUES (lower(hex(randomblob(16))),NEW.company_id,NEW.id,'VOIDED',NEW.voided_by,NEW.void_reason);
END;

CREATE TRIGGER IF NOT EXISTS provider_message_captures_no_delete
BEFORE DELETE ON provider_message_captures
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_MESSAGE_CAPTURE_RETAINED');
END;

CREATE TRIGGER IF NOT EXISTS provider_message_captures_review_only
BEFORE UPDATE ON provider_message_captures
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.company_id IS OLD.company_id
  AND NEW.branch_id IS OLD.branch_id
  AND NEW.provider_relationship_id IS OLD.provider_relationship_id
  AND NEW.provider_outlet_account_id IS OLD.provider_outlet_account_id
  AND NEW.source_kind IS OLD.source_kind
  AND NEW.sender_label IS OLD.sender_label
  AND NEW.source_app_label IS OLD.source_app_label
  AND NEW.message_received_at IS OLD.message_received_at
  AND NEW.message_fingerprint IS OLD.message_fingerprint
  AND NEW.evidence_file_id IS OLD.evidence_file_id
  AND NEW.received_by IS OLD.received_by
  AND NEW.created_at IS OLD.created_at
  AND NEW.parse_status IN ('CAPTURED','PARSED','NEEDS_REVIEW','ACCEPTED','REJECTED','DUPLICATE')
)
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_MESSAGE_SOURCE_IMMUTABLE');
END;

-- Otya Enterprise additive foundation for corporate operations and automated capture.
-- Apply only as a forward migration to the isolated Otya/OPoint staging D1 database.
-- This migration records business operations; it does not initiate, route or settle payments.
-- Never store provider PINs, passwords, PUKs, API secrets or payment credentials here.

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  department_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, department_code),
  UNIQUE(company_id, id)
);

CREATE TABLE IF NOT EXISTS job_positions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  department_id TEXT,
  position_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, department_id) REFERENCES departments(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, position_code),
  UNIQUE(company_id, id)
);

CREATE TABLE IF NOT EXISTS employee_profiles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  staff_membership_id TEXT NOT NULL,
  employee_number TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'PERMANENT'
    CHECK (employment_type IN ('PERMANENT','FIXED_TERM','CASUAL','CONTRACTOR','INTERN')),
  employment_status TEXT NOT NULL DEFAULT 'PREBOARDING'
    CHECK (employment_status IN ('PREBOARDING','ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED')),
  hire_date TEXT,
  end_date TEXT,
  work_phone TEXT,
  work_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, staff_membership_id) REFERENCES staff_memberships(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, employee_number),
  UNIQUE(company_id, staff_membership_id),
  UNIQUE(company_id, id),
  CHECK (end_date IS NULL OR hire_date IS NULL OR end_date >= hire_date)
);

CREATE TABLE IF NOT EXISTS employee_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  employee_profile_id TEXT NOT NULL,
  branch_id TEXT,
  department_id TEXT,
  position_id TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'PRIMARY'
    CHECK (assignment_type IN ('PRIMARY','SECONDARY','TEMPORARY','ACTING')),
  starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','ENDED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, employee_profile_id) REFERENCES employee_profiles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, department_id) REFERENCES departments(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, position_id) REFERENCES job_positions(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_active
  ON employee_assignments(company_id, employee_profile_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_branch
  ON employee_assignments(company_id, branch_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_one_active_primary_assignment
  ON employee_assignments(company_id, employee_profile_id)
  WHERE assignment_type = 'PRIMARY' AND status = 'ACTIVE' AND ends_at IS NULL;

CREATE TABLE IF NOT EXISTS employee_permission_grants (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  employee_profile_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('COMPANY','BRANCH','PROVIDER_ACCOUNT','ASSET','DEPARTMENT')),
  scope_id TEXT,
  starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED','EXPIRED')),
  granted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, employee_profile_id) REFERENCES employee_profiles(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (scope_type = 'COMPANY' AND scope_id IS NULL OR scope_type <> 'COMPANY' AND scope_id IS NOT NULL),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_employee_permission_grants_scope
  ON employee_permission_grants(company_id, employee_profile_id, status, permission_key, scope_type, scope_id);

CREATE TABLE IF NOT EXISTS employee_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  employee_profile_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'CONFIDENTIAL'
    CHECK (classification IN ('INTERNAL','CONFIDENTIAL','RESTRICTED')),
  document_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (document_status IN ('ACTIVE','SUPERSEDED','WITHDRAWN')),
  issued_at TEXT,
  expires_at TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, employee_profile_id) REFERENCES employee_profiles(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at)
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
  ON employee_documents(company_id, employee_profile_id, document_status, document_type);

CREATE TABLE IF NOT EXISTS company_assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT,
  asset_tag TEXT NOT NULL,
  asset_type TEXT NOT NULL
    CHECK (asset_type IN ('ANDROID_PHONE','POS_TERMINAL','LAPTOP','DESKTOP','PRINTER','SIM_CARD','CASH_DRAWER','SCANNER','OTHER')),
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  imei1 TEXT,
  imei2 TEXT,
  purchase_date TEXT,
  purchase_amount INTEGER CHECK (purchase_amount IS NULL OR purchase_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  lifecycle_status TEXT NOT NULL DEFAULT 'IN_STOCK'
    CHECK (lifecycle_status IN ('IN_STOCK','ASSIGNED','IN_REPAIR','LOST','STOLEN','RETIRED','DISPOSED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, asset_tag),
  UNIQUE(company_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_assets_imei1
  ON company_assets(company_id, imei1) WHERE imei1 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_assets_imei2
  ON company_assets(company_id, imei2) WHERE imei2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_assets_branch_status
  ON company_assets(company_id, branch_id, lifecycle_status, asset_type);

CREATE TABLE IF NOT EXISTS company_sim_details (
  asset_id TEXT PRIMARY KEY REFERENCES company_assets(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  msisdn TEXT NOT NULL,
  iccid TEXT NOT NULL,
  network_code TEXT NOT NULL CHECK (network_code IN ('AIRTEL','MTN','OTHER')),
  registration_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (registration_status IN ('PENDING','COMPANY_REGISTERED','REJECTED','SUSPENDED','CLOSED')),
  registration_reference TEXT,
  registered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, asset_id) REFERENCES company_assets(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, msisdn),
  UNIQUE(company_id, iccid)
);

CREATE TABLE IF NOT EXISTS asset_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL,
  employee_profile_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_return_at TEXT,
  returned_at TEXT,
  returned_to TEXT,
  condition_on_issue TEXT,
  condition_on_return TEXT,
  status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','RETURNED','LOST','DISPUTED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, asset_id) REFERENCES company_assets(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, employee_profile_id) REFERENCES employee_profiles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (returned_at IS NULL OR returned_at >= issued_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_one_open_assignment
  ON asset_assignments(company_id, asset_id)
  WHERE status = 'ISSUED' AND returned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_assignments_employee
  ON asset_assignments(company_id, employee_profile_id, status, issued_at);

CREATE TABLE IF NOT EXISTS provider_relationships (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL CHECK (provider_code IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  legal_entity_name TEXT NOT NULL,
  corporate_agent_reference TEXT,
  agreement_reference TEXT,
  commission_account_reference TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (onboarding_status IN ('NOT_STARTED','APPLICATION','DUE_DILIGENCE','PENDING_APPROVAL','ACTIVE','SUSPENDED','CLOSED')),
  approved_at TEXT,
  expires_at TEXT,
  provider_contact_name TEXT,
  provider_contact_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider_code),
  UNIQUE(company_id, id),
  CHECK (expires_at IS NULL OR approved_at IS NULL OR expires_at >= approved_at)
);

CREATE TABLE IF NOT EXISTS provider_outlet_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_relationship_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cash_account_id TEXT,
  outlet_account_reference TEXT,
  account_kind TEXT NOT NULL
    CHECK (account_kind IN ('AGENT_FLOAT','MERCHANT_TILL','PAYPOINT','COMMISSION','SETTLEMENT','OTHER')),
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, provider_relationship_id) REFERENCES provider_relationships(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, cash_account_id) REFERENCES cash_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, provider_relationship_id, branch_id, account_kind, outlet_account_reference)
);
CREATE INDEX IF NOT EXISTS idx_provider_outlet_accounts_branch
  ON provider_outlet_accounts(company_id, branch_id, status, account_kind);

CREATE TABLE IF NOT EXISTS provider_operator_profiles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_relationship_id TEXT NOT NULL,
  provider_outlet_account_id TEXT,
  employee_profile_id TEXT NOT NULL,
  provider_operator_reference TEXT,
  sim_asset_id TEXT,
  approval_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING','APPROVED','REJECTED','SUSPENDED','REVOKED')),
  training_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (training_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','EXPIRED')),
  approved_at TEXT,
  training_completed_at TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, provider_relationship_id) REFERENCES provider_relationships(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, employee_profile_id) REFERENCES employee_profiles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, sim_asset_id) REFERENCES company_assets(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (valid_until IS NULL OR approved_at IS NULL OR valid_until >= approved_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operator_reference
  ON provider_operator_profiles(company_id, provider_relationship_id, provider_operator_reference)
  WHERE provider_operator_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provider_operator_employee
  ON provider_operator_profiles(company_id, employee_profile_id, approval_status);

CREATE TABLE IF NOT EXISTS provider_balance_observations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT NOT NULL,
  balance_kind TEXT NOT NULL CHECK (balance_kind IN ('AVAILABLE_FLOAT','LEDGER_FLOAT','COMMISSION','SETTLEMENT','OTHER')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  observed_at TEXT NOT NULL,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('PROVIDER_PORTAL','PROVIDER_STATEMENT','APPROVED_READ_ONLY_FEED','SIGNED_PROVIDER_REPORT','STAFF_ATTESTATION')),
  evidence_file_id TEXT REFERENCES stored_files(id) ON DELETE RESTRICT,
  source_reference TEXT,
  recorded_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_provider_balance_latest
  ON provider_balance_observations(company_id, provider_outlet_account_id, balance_kind, observed_at DESC);

CREATE TABLE IF NOT EXISTS capture_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT,
  capture_kind TEXT NOT NULL
    CHECK (capture_kind IN ('PRODUCT_BARCODE','PRODUCT_QR','IMEI','SERIAL_NUMBER','SIM_ICCID','EMPLOYEE_QR','PROVIDER_RECEIPT','PROVIDER_STATEMENT','DOCUMENT','OTHER')),
  capture_method TEXT NOT NULL
    CHECK (capture_method IN ('CAMERA_SCAN','QR_SCAN','BARCODE_SCAN','NFC_SCAN','FILE_UPLOAD','STATEMENT_IMPORT','MANUAL_EXCEPTION')),
  stored_file_id TEXT REFERENCES stored_files(id) ON DELETE RESTRICT,
  input_fingerprint TEXT NOT NULL,
  extracted_data_json TEXT,
  extraction_confidence INTEGER CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'CAPTURED'
    CHECK (status IN ('CAPTURED','EXTRACTED','NEEDS_REVIEW','ACCEPTED','REJECTED','DUPLICATE')),
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_capture_records_review
  ON capture_records(company_id, status, capture_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS capture_extractions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  capture_record_id TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  extractor_version TEXT,
  output_schema_version TEXT NOT NULL,
  extracted_fields_json TEXT NOT NULL,
  confidence_by_field_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, capture_record_id) REFERENCES capture_records(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id)
);

CREATE TABLE IF NOT EXISTS provider_statement_imports (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  file_sha256 TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('CSV','XLSX','PDF','OTHER')),
  period_start TEXT,
  period_end TEXT,
  import_status TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (import_status IN ('UPLOADED','PARSING','NEEDS_REVIEW','ACCEPTED','REJECTED','FAILED')),
  rows_seen INTEGER NOT NULL DEFAULT 0 CHECK (rows_seen >= 0),
  rows_imported INTEGER NOT NULL DEFAULT 0 CHECK (rows_imported >= 0),
  rows_duplicate INTEGER NOT NULL DEFAULT 0 CHECK (rows_duplicate >= 0),
  uploaded_by TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, file_sha256),
  UNIQUE(company_id, id),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_provider_statement_imports_status
  ON provider_statement_imports(company_id, import_status, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_transaction_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  provider_outlet_account_id TEXT NOT NULL,
  provider_operator_profile_id TEXT,
  capture_record_id TEXT,
  provider_reference TEXT NOT NULL,
  transaction_kind TEXT NOT NULL
    CHECK (transaction_kind IN ('CASH_IN','CASH_OUT','AIRTIME','DATA','BILL_PAYMENT','MERCHANT_COLLECTION','REVERSAL','OTHER')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  provider_status TEXT NOT NULL DEFAULT 'NOT_CHECKED'
    CHECK (provider_status IN ('NOT_CHECKED','PENDING','SUCCEEDED','FAILED','UNKNOWN','REVERSED')),
  evidence_level TEXT NOT NULL DEFAULT 'STAFF_REPORTED'
    CHECK (evidence_level IN ('STAFF_REPORTED','RECEIPT_REVIEWED','STATEMENT_MATCHED','PROVIDER_FEED')),
  provider_occurred_at TEXT,
  recorded_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_operator_profile_id) REFERENCES provider_operator_profiles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, capture_record_id) REFERENCES capture_records(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, provider_outlet_account_id, provider_reference),
  UNIQUE(company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_provider_transaction_records_branch_time
  ON provider_transaction_records(company_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_transaction_records_operator_time
  ON provider_transaction_records(company_id, provider_operator_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_transaction_records_status
  ON provider_transaction_records(company_id, provider_status, evidence_level, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_statement_rows (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL,
  provider_outlet_account_id TEXT NOT NULL,
  provider_transaction_record_id TEXT,
  provider_reference TEXT NOT NULL,
  transaction_kind TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  provider_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (provider_status IN ('PENDING','SUCCEEDED','FAILED','UNKNOWN','REVERSED')),
  occurred_at TEXT,
  sanitized_source_json TEXT,
  match_status TEXT NOT NULL DEFAULT 'UNMATCHED'
    CHECK (match_status IN ('UNMATCHED','MATCHED','DUPLICATE','DISPUTED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, import_id) REFERENCES provider_statement_imports(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_outlet_account_id) REFERENCES provider_outlet_accounts(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, provider_transaction_record_id) REFERENCES provider_transaction_records(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, provider_outlet_account_id, provider_reference)
);
CREATE INDEX IF NOT EXISTS idx_provider_statement_rows_import
  ON provider_statement_rows(company_id, import_id, match_status);

CREATE TRIGGER IF NOT EXISTS provider_balance_observations_no_update
BEFORE UPDATE ON provider_balance_observations
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_BALANCE_OBSERVATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS provider_balance_observations_no_delete
BEFORE DELETE ON provider_balance_observations
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_BALANCE_OBSERVATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS provider_transaction_records_no_update
BEFORE UPDATE ON provider_transaction_records
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_TRANSACTION_RECORD_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS provider_transaction_records_no_delete
BEFORE DELETE ON provider_transaction_records
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_TRANSACTION_RECORD_APPEND_ONLY');
END;

CREATE INDEX IF NOT EXISTS idx_provider_relationships_company_status
  ON provider_relationships(company_id, onboarding_status, provider_code);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_status
  ON employee_profiles(company_id, employment_status, employee_number);

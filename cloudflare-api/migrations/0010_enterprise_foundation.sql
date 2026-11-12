-- Otya Enterprise v1 foundation. Additive/source-only migration.
-- Do NOT apply remotely until reviewed, backed up, and explicitly approved.
-- All money values are whole UGX integers. External provider balances are
-- observations; Otya book balances are separate internal records.

ALTER TABLE omni_retail_sales ADD COLUMN outlet_id TEXT;
CREATE INDEX IF NOT EXISTS idx_omni_sales_company_outlet_created
  ON omni_retail_sales(company_id, outlet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_enterprise_outlets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_code TEXT NOT NULL,
  name TEXT NOT NULL,
  outlet_type TEXT NOT NULL DEFAULT 'RETAIL_AND_AGENCY'
    CHECK (outlet_type IN ('RETAIL','AGENCY','RETAIL_AND_AGENCY','OFFICE','WAREHOUSE')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
  country_code TEXT NOT NULL DEFAULT 'UG',
  district TEXT,
  city_or_town TEXT,
  physical_address TEXT NOT NULL,
  latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  local_authority_reference TEXT,
  opening_date TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, outlet_code)
);
CREATE INDEX IF NOT EXISTS idx_omni_enterprise_outlets_company_status
  ON omni_enterprise_outlets(company_id, status, outlet_code);

CREATE TABLE IF NOT EXISTS omni_enterprise_departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  department_code TEXT NOT NULL,
  name TEXT NOT NULL,
  manager_employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, department_code)
);

CREATE TABLE IF NOT EXISTS omni_enterprise_employees (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  staff_membership_id TEXT NOT NULL UNIQUE
    REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  employee_number TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  preferred_name TEXT,
  department_id TEXT REFERENCES omni_enterprise_departments(id) ON DELETE RESTRICT,
  job_title TEXT,
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME'
    CHECK (employment_type IN ('FULL_TIME','PART_TIME','CASUAL','CONTRACT','DIRECTOR','INTERN')),
  employment_status TEXT NOT NULL DEFAULT 'ONBOARDING'
    CHECK (employment_status IN ('ONBOARDING','ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED')),
  start_date TEXT,
  end_date TEXT,
  work_email TEXT,
  work_phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, employee_number)
);
CREATE INDEX IF NOT EXISTS idx_omni_enterprise_employees_company_status
  ON omni_enterprise_employees(company_id, employment_status, employee_number);

CREATE TABLE IF NOT EXISTS omni_employee_outlet_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING','ACTIVE','ENDED','REVOKED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_omni_employee_outlet_scope
  ON omni_employee_outlet_assignments(company_id, employee_id, status, outlet_id);

CREATE TABLE IF NOT EXISTS omni_permission_catalog (
  permission_key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1))
);
INSERT OR IGNORE INTO omni_permission_catalog(permission_key,description,sensitive) VALUES
 ('outlets.read','View assigned outlets',0),
 ('outlets.manage','Create and manage company outlets',1),
 ('staff.read.assigned','View assigned workforce details',0),
 ('staff.manage','Manage employment and staff access',1),
 ('providers.read.assigned','View assigned provider accounts and records',0),
 ('providers.manage','Manage provider relationships and outlet account records',1),
 ('provider_balances.record','Record a provider balance observation',0),
 ('provider_balances.read.company','View consolidated provider balance observations',0),
 ('evidence.submit','Submit transaction evidence for review',0),
 ('evidence.review','Review submitted transaction evidence',1),
 ('agency.records.read.assigned','View assigned agency records',0),
 ('agency.reconcile','Reconcile provider records and cash/float books',1),
 ('retail.sell','Create retail sales and customer receipts',0),
 ('retail.inventory.read','View assigned outlet stock',0),
 ('retail.inventory.manage','Receive, transfer and adjust inventory',1),
 ('finance.read','View company financial reports',1),
 ('finance.approve','Approve financial adjustments and reconciliations',1),
 ('assets.read.assigned','View assigned company assets',0),
 ('assets.manage','Register and assign company assets',1),
 ('documents.read.assigned','View assigned company documents',0),
 ('documents.manage','Manage company documents and retention',1),
 ('hr.read','View permitted HR records',1),
 ('hr.manage','Manage employment records and HR workflows',1),
 ('audit.read','View audit events',1),
 ('reports.read.assigned','View assigned operational reports',0);

CREATE TABLE IF NOT EXISTS omni_staff_permission_grants (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  staff_membership_id TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  permission_key TEXT NOT NULL REFERENCES omni_permission_catalog(permission_key) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('COMPANY','OUTLET','PROVIDER_ACCOUNT','SELF')),
  scope_id TEXT,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED','EXPIRED')),
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_type = 'COMPANY' AND scope_id IS NULL) OR (scope_type <> 'COMPANY' AND scope_id IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_omni_staff_permission_scope
  ON omni_staff_permission_grants(company_id, staff_membership_id, status, permission_key);

CREATE TABLE IF NOT EXISTS omni_provider_relationships (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  provider_product TEXT NOT NULL,
  legal_agent_name TEXT NOT NULL,
  parent_agent_id TEXT,
  common_display_agent_id TEXT,
  agreement_reference TEXT,
  agreement_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
    CHECK (agreement_status IN ('NOT_SUBMITTED','SUBMITTED','UNDER_REVIEW','APPROVED','SUSPENDED','TERMINATED')),
  central_commission_account_ref TEXT,
  reporting_capability TEXT NOT NULL DEFAULT 'NOT_CONFIRMED'
    CHECK (reporting_capability IN ('NOT_CONFIRMED','PORTAL','STATEMENT_EXPORT','READ_ONLY_FEED','NONE')),
  starts_at TEXT,
  ends_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider, provider_product, parent_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_omni_provider_relationships_company
  ON omni_provider_relationships(company_id, provider, agreement_status);

CREATE TABLE IF NOT EXISTS omni_provider_outlet_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider_relationship_id TEXT NOT NULL REFERENCES omni_provider_relationships(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  provider_outlet_id TEXT,
  provider_account_reference TEXT,
  account_label TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('AGENT_FLOAT','TELLER_FLOAT','MERCHANT_TILL','SETTLEMENT','COMMISSION','OTHER')),
  account_scope TEXT NOT NULL DEFAULT 'OUTLET' CHECK (account_scope IN ('OUTLET','TELLER')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
  approved_at TEXT,
  closed_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (account_scope <> 'TELLER' OR account_type = 'TELLER_FLOAT')
);
CREATE INDEX IF NOT EXISTS idx_omni_provider_outlet_accounts_scope
  ON omni_provider_outlet_accounts(company_id, provider_relationship_id, outlet_id, status);
CREATE INDEX IF NOT EXISTS idx_omni_provider_outlet_accounts_external
  ON omni_provider_outlet_accounts(provider_relationship_id, provider_outlet_id, provider_account_reference);

CREATE TABLE IF NOT EXISTS omni_provider_operator_profiles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider_relationship_id TEXT NOT NULL REFERENCES omni_provider_relationships(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT NOT NULL REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  provider_operator_id TEXT,
  provider_username TEXT,
  approved_reference TEXT,
  approval_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING','TRAINING','APPROVED','SUSPENDED','REVOKED')),
  approved_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_operator_external_id
  ON omni_provider_operator_profiles(provider_relationship_id, provider_operator_id)
  WHERE provider_operator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_omni_provider_operator_employee
  ON omni_provider_operator_profiles(company_id, employee_id, approval_status);

CREATE TABLE IF NOT EXISTS omni_company_sim_cards (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  carrier TEXT NOT NULL CHECK (carrier IN ('AIRTEL','MTN','OTHER')),
  msisdn TEXT NOT NULL,
  iccid TEXT,
  company_registration_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (company_registration_status IN ('PENDING','REGISTERED','REJECTED','SUSPENDED','RETIRED')),
  use_type TEXT NOT NULL CHECK (use_type IN ('AGENCY_OPERATION','BUSINESS_VOICE_DATA','DEVICE_CONNECTIVITY','OTHER')),
  status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','ASSIGNED','SUSPENDED','LOST','RETIRED')),
  registration_evidence_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, msisdn),
  UNIQUE(company_id, iccid)
);
CREATE INDEX IF NOT EXISTS idx_omni_company_sim_status
  ON omni_company_sim_cards(company_id, carrier, status);

CREATE TABLE IF NOT EXISTS omni_company_devices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  asset_tag TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('ANDROID_PHONE','PROVIDER_TERMINAL','TABLET','COMPUTER','PRINTER','SCANNER','ROUTER','OTHER')),
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  imei_1 TEXT,
  imei_2 TEXT,
  ownership_type TEXT NOT NULL DEFAULT 'COMPANY_OWNED'
    CHECK (ownership_type IN ('COMPANY_OWNED','LEASED','PROVIDER_ISSUED')),
  status TEXT NOT NULL DEFAULT 'IN_STOCK'
    CHECK (status IN ('IN_STOCK','ASSIGNED','REPAIR','LOST','STOLEN','RETIRED')),
  managed_device INTEGER NOT NULL DEFAULT 0 CHECK (managed_device IN (0,1)),
  acquired_at TEXT,
  warranty_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, asset_tag)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_device_imei1
  ON omni_company_devices(imei_1) WHERE imei_1 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_device_imei2
  ON omni_company_devices(imei_2) WHERE imei_2 IS NOT NULL;

CREATE TABLE IF NOT EXISTS omni_sim_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sim_card_id TEXT NOT NULL REFERENCES omni_company_sim_cards(id) ON DELETE RESTRICT,
  employee_id TEXT REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETURNED','REVOKED')),
  issued_by TEXT NOT NULL,
  returned_to TEXT,
  return_condition TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_omni_sim_assignment_active
  ON omni_sim_assignments(company_id, sim_card_id, status, starts_at DESC);

CREATE TABLE IF NOT EXISTS omni_device_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES omni_company_devices(id) ON DELETE RESTRICT,
  employee_id TEXT REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETURNED','REVOKED')),
  issued_by TEXT NOT NULL,
  returned_to TEXT,
  return_condition TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (returned_at IS NULL OR returned_at > issued_at)
);
CREATE INDEX IF NOT EXISTS idx_omni_device_assignment_active
  ON omni_device_assignments(company_id, device_id, status, issued_at DESC);

CREATE TABLE IF NOT EXISTS omni_outlet_operating_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('RETAIL_CASH','AGENCY_CASH','PROVIDER_FLOAT','COMMISSION_CLEARING','EXPENSE_CASH')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  provider_outlet_account_id TEXT REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  assigned_employee_id TEXT REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  book_balance_ugx INTEGER NOT NULL DEFAULT 0 CHECK (book_balance_ugx >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, outlet_id, account_code),
  CHECK (
    (account_type = 'PROVIDER_FLOAT' AND provider IS NOT NULL AND provider_outlet_account_id IS NOT NULL)
    OR
    (account_type <> 'PROVIDER_FLOAT' AND provider IS NULL AND provider_outlet_account_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_accounts_scope
  ON omni_outlet_operating_accounts(company_id, outlet_id, account_type, status);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_accounts_provider
  ON omni_outlet_operating_accounts(company_id, provider, provider_outlet_account_id);

CREATE TABLE IF NOT EXISTS omni_outlet_account_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES omni_outlet_operating_accounts(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('OPENING_BALANCE','SALE','CASH_IN','CASH_OUT','FLOAT_TOPUP','FLOAT_WITHDRAWAL','COMMISSION','EXPENSE','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT','REVERSAL')),
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_ugx INTEGER NOT NULL CHECK (amount_ugx > 0),
  balance_after_ugx INTEGER NOT NULL CHECK (balance_after_ugx >= 0),
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_movements_account
  ON omni_outlet_account_movements(company_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_movements_reference
  ON omni_outlet_account_movements(company_id, reference_type, reference_id);

CREATE TRIGGER IF NOT EXISTS omni_outlet_account_movement_guard
BEFORE INSERT ON omni_outlet_account_movements
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM omni_outlet_operating_accounts
      WHERE id = NEW.account_id AND company_id = NEW.company_id AND status = 'ACTIVE'
    ) THEN RAISE(ABORT, 'OUTLET_ACCOUNT_NOT_AVAILABLE')
  END;
  SELECT CASE
    WHEN NEW.balance_after_ugx != (
      SELECT book_balance_ugx + CASE WHEN NEW.direction = 'IN' THEN NEW.amount_ugx ELSE -NEW.amount_ugx END
      FROM omni_outlet_operating_accounts WHERE id = NEW.account_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'OUTLET_ACCOUNT_BALANCE_CONFLICT')
  END;
END;
CREATE TRIGGER IF NOT EXISTS omni_outlet_account_movement_apply
AFTER INSERT ON omni_outlet_account_movements
BEGIN
  UPDATE omni_outlet_operating_accounts
     SET book_balance_ugx = NEW.balance_after_ugx, updated_at = CURRENT_TIMESTAMP
   WHERE id = NEW.account_id AND company_id = NEW.company_id;
END;
CREATE TRIGGER IF NOT EXISTS omni_outlet_account_movements_no_update
BEFORE UPDATE ON omni_outlet_account_movements
BEGIN
  SELECT RAISE(ABORT, 'OUTLET_ACCOUNT_MOVEMENTS_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_outlet_account_movements_no_delete
BEFORE DELETE ON omni_outlet_account_movements
BEGIN
  SELECT RAISE(ABORT, 'OUTLET_ACCOUNT_MOVEMENTS_APPEND_ONLY');
END;

CREATE TABLE IF NOT EXISTS omni_evidence_files (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  uploaded_by TEXT NOT NULL,
  storage_object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','application/pdf','text/csv','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('PROVIDER_RECEIPT','PROVIDER_STATEMENT','SMS_SCREENSHOT','SHARED_MESSAGE_EXPORT','RETAIL_RECEIPT','SUPPLIER_INVOICE','STAFF_DOCUMENT','OTHER')),
  retention_class TEXT NOT NULL DEFAULT 'BUSINESS_RECORD'
    CHECK (retention_class IN ('BUSINESS_RECORD','PERSONNEL_CONFIDENTIAL','FINANCIAL_CONFIDENTIAL','TEMPORARY_REVIEW')),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_omni_evidence_company_uploaded
  ON omni_evidence_files(company_id, outlet_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS omni_evidence_ingestion_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT NOT NULL REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  evidence_file_id TEXT REFERENCES omni_evidence_files(id) ON DELETE RESTRICT,
  submitted_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('USER_SHARED_TEXT','SCREENSHOT_UPLOAD','RECEIPT_UPLOAD','STATEMENT_IMPORT','CSV_IMPORT','PROVIDER_READ_ONLY_FEED','MANUAL_ENTRY')),
  source_message_hash TEXT,
  sender_label TEXT,
  received_at TEXT,
  parser_version TEXT,
  extracted_fields_json TEXT NOT NULL,
  parse_confidence REAL NOT NULL DEFAULT 0 CHECK (parse_confidence >= 0 AND parse_confidence <= 1),
  parse_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (parse_status IN ('RECEIVED','NEEDS_REVIEW','APPROVED_FOR_RECORDING','REJECTED','DUPLICATE','FAILED')),
  reviewed_by TEXT REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_message_hash IS NULL OR length(source_message_hash) = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_evidence_message_dedupe
  ON omni_evidence_ingestion_items(company_id, provider, source_message_hash)
  WHERE source_message_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_omni_evidence_review_queue
  ON omni_evidence_ingestion_items(company_id, outlet_id, parse_status, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_provider_transaction_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  provider_relationship_id TEXT NOT NULL REFERENCES omni_provider_relationships(id) ON DELETE RESTRICT,
  provider_outlet_account_id TEXT NOT NULL REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  employee_id TEXT REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  evidence_ingestion_id TEXT REFERENCES omni_evidence_ingestion_items(id) ON DELETE RESTRICT,
  provider_reference TEXT,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('CASH_IN','CASH_OUT','AIRTIME','DATA','BILL_PAYMENT','MERCHANT_PAYMENT','FLOAT_TOPUP','FLOAT_WITHDRAWAL','REVERSAL','OTHER')),
  amount_ugx INTEGER NOT NULL CHECK (amount_ugx > 0),
  commission_ugx INTEGER NOT NULL DEFAULT 0 CHECK (commission_ugx >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  source_status_claim TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (source_status_claim IN ('SUCCESS_REPORTED','FAILED_REPORTED','REVERSED_REPORTED','UNKNOWN')),
  verification_level TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_level IN ('UNVERIFIED','OPERATOR_REVIEWED','RECEIPT_REVIEWED','STATEMENT_MATCHED','READ_ONLY_PROVIDER_CONFIRMED')),
  provider_transaction_at TEXT,
  recorded_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_txn_ref
  ON omni_provider_transaction_records(company_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_omni_provider_txn_outlet_time
  ON omni_provider_transaction_records(company_id, outlet_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_transaction_verification_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  transaction_record_id TEXT NOT NULL REFERENCES omni_provider_transaction_records(id) ON DELETE RESTRICT,
  verification_level TEXT NOT NULL
    CHECK (verification_level IN ('OPERATOR_REVIEWED','RECEIPT_REVIEWED','STATEMENT_MATCHED','READ_ONLY_PROVIDER_CONFIRMED','DISPUTED')),
  evidence_file_id TEXT REFERENCES omni_evidence_files(id) ON DELETE RESTRICT,
  verified_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_txn_verification_history
  ON omni_transaction_verification_events(company_id, transaction_record_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS omni_txn_verification_events_no_update
BEFORE UPDATE ON omni_transaction_verification_events
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_VERIFICATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_txn_verification_events_no_delete
BEFORE DELETE ON omni_transaction_verification_events
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_VERIFICATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_provider_transaction_records_no_update
BEFORE UPDATE ON omni_provider_transaction_records
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_TRANSACTION_RECORD_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_provider_transaction_records_no_delete
BEFORE DELETE ON omni_provider_transaction_records
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_TRANSACTION_RECORD_APPEND_ONLY');
END;

CREATE TABLE IF NOT EXISTS omni_provider_balance_observations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  provider_outlet_account_id TEXT NOT NULL REFERENCES omni_provider_outlet_accounts(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  reported_balance_ugx INTEGER NOT NULL CHECK (reported_balance_ugx >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('PROVIDER_PORTAL','PROVIDER_STATEMENT','PROVIDER_RECEIPT','USER_SHARED_TEXT','MANUAL_ENTRY','READ_ONLY_PROVIDER_FEED')),
  verification_level TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_level IN ('UNVERIFIED','OPERATOR_REVIEWED','STATEMENT_MATCHED','READ_ONLY_PROVIDER_CONFIRMED')),
  evidence_file_id TEXT REFERENCES omni_evidence_files(id) ON DELETE RESTRICT,
  observed_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_provider_balance_latest
  ON omni_provider_balance_observations(company_id, provider, outlet_id, provider_outlet_account_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS omni_outlet_stock_balances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES omni_products(id) ON DELETE RESTRICT,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, outlet_id, product_id),
  CHECK (quantity_reserved <= quantity_on_hand)
);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_stock_low
  ON omni_outlet_stock_balances(company_id, outlet_id, quantity_on_hand, reorder_level);

CREATE TABLE IF NOT EXISTS omni_outlet_stock_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES omni_products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING','PURCHASE','SALE','TRANSFER_IN','TRANSFER_OUT','RETURN','DAMAGE','ADJUSTMENT')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_outlet_stock_history
  ON omni_outlet_stock_movements(company_id, outlet_id, product_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS omni_outlet_stock_movements_no_update
BEFORE UPDATE ON omni_outlet_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'OUTLET_STOCK_MOVEMENTS_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_outlet_stock_movements_no_delete
BEFORE DELETE ON omni_outlet_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'OUTLET_STOCK_MOVEMENTS_APPEND_ONLY');
END;

CREATE TABLE IF NOT EXISTS omni_receipt_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL,
  receipt_type TEXT NOT NULL
    CHECK (receipt_type IN ('RETAIL_SALES_RECEIPT','RETAIL_TAX_INVOICE','AGENCY_SERVICE_ACKNOWLEDGEMENT')),
  source_type TEXT NOT NULL CHECK (source_type IN ('RETAIL_SALE','PROVIDER_TRANSACTION_RECORD')),
  source_id TEXT NOT NULL,
  provider TEXT CHECK (provider IS NULL OR provider IN ('AIRTEL_MONEY','MTN_MOMO','INTERSWITCH_QUICKTELLER')),
  provider_reference TEXT,
  verification_label TEXT NOT NULL DEFAULT 'INTERNAL_RECORD_ONLY'
    CHECK (verification_label IN ('INTERNAL_RECORD_ONLY','SOURCE_EVIDENCE_REVIEWED','PROVIDER_STATEMENT_MATCHED','PROVIDER_FEED_CONFIRMED')),
  receipt_status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (receipt_status IN ('DRAFT','ISSUED','VOIDED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  total_ugx INTEGER NOT NULL CHECK (total_ugx >= 0),
  content_snapshot_json TEXT NOT NULL,
  customer_disclaimer TEXT,
  r2_object_key TEXT,
  issued_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, receipt_number),
  UNIQUE(company_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_omni_receipts_outlet_date
  ON omni_receipt_documents(company_id, outlet_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS omni_approval_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('FLOAT_ADJUSTMENT','CASH_ADJUSTMENT','STOCK_ADJUSTMENT','REFUND','RECONCILIATION','ASSET_TRANSFER','STAFF_ACCESS','DOCUMENT_APPROVAL')),
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  requested_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  assigned_approver TEXT REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  request_payload_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  CHECK (assigned_approver IS NULL OR assigned_approver <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_omni_approval_queue
  ON omni_approval_requests(company_id, status, outlet_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS omni_approval_decisions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  approval_request_id TEXT NOT NULL REFERENCES omni_approval_requests(id) ON DELETE RESTRICT,
  decided_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(approval_request_id, decided_by)
);

CREATE TABLE IF NOT EXISTS omni_attendance_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END','MANAGER_CORRECTION')),
  event_at TEXT NOT NULL,
  captured_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL DEFAULT 'STAFF_APP' CHECK (source_type IN ('STAFF_APP','MANAGER_ENTRY','APPROVED_DEVICE')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_attendance_employee_time
  ON omni_attendance_events(company_id, employee_id, event_at DESC);

CREATE TABLE IF NOT EXISTS omni_leave_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  review_note TEXT,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_omni_leave_company_status
  ON omni_leave_requests(company_id, status, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS omni_corporate_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  outlet_id TEXT REFERENCES omni_enterprise_outlets(id) ON DELETE RESTRICT,
  employee_id TEXT REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  classification TEXT NOT NULL DEFAULT 'CONFIDENTIAL'
    CHECK (classification IN ('INTERNAL','CONFIDENTIAL','PERSONNEL_CONFIDENTIAL','FINANCIAL_CONFIDENTIAL','RESTRICTED')),
  issued_on TEXT,
  expires_on TEXT,
  retention_until TEXT,
  uploaded_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_corporate_docs_company_type
  ON omni_corporate_documents(company_id, document_type, expires_on);

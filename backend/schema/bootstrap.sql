-- Opoint schema-only bootstrap snapshot exported from its isolated staging D1 database on 2026-11-11.
-- Contains DDL only. No application rows, customer data, payments, media metadata or secrets are included.
-- Cloudflare-managed _cf_KV is intentionally excluded. Apply only to a brand-new empty product D1 database.
PRAGMA foreign_keys = ON;

-- table: agency_operations
CREATE TABLE agency_operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  payment_intent_id TEXT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('CASH_IN','CASH_OUT')),
  provider_code TEXT NOT NULL CHECK (provider_code IN ('MTN_MOMO','AIRTEL_MONEY')),
  provider_reference TEXT NOT NULL,
  customer_reference_last4 TEXT CHECK (customer_reference_last4 IS NULL OR length(customer_reference_last4) = 4),
  amount INTEGER NOT NULL CHECK (amount > 0),
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  recording_mode TEXT NOT NULL CHECK (recording_mode IN ('MANUAL_UNVERIFIED','PROVIDER_CONFIRMED')),
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','PENDING','CONFIRMED','REJECTED','UNKNOWN','REVERSED')),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, provider_code, provider_reference),
  UNIQUE(company_id, id)
);

-- table: api_rate_limits
CREATE TABLE api_rate_limits (
  scope_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: audit_events
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  request_id TEXT NOT NULL,
  before_state_json TEXT,
  after_state_json TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: biller_catalog
CREATE TABLE biller_catalog (
  id TEXT PRIMARY KEY,
  provider_code TEXT NOT NULL CHECK (provider_code IN ('QUICKTELLER','INTERSWITCH')),
  provider_biller_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'UG',
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','UNAVAILABLE')),
  last_synced_at TEXT,
  UNIQUE(provider_code, provider_biller_code)
);

-- table: biller_payment_items
CREATE TABLE biller_payment_items (
  id TEXT PRIMARY KEY,
  biller_id TEXT NOT NULL REFERENCES biller_catalog(id) ON DELETE RESTRICT,
  provider_item_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  requires_customer_validation INTEGER NOT NULL DEFAULT 1 CHECK (requires_customer_validation IN (0,1)),
  allows_customer_amount INTEGER NOT NULL DEFAULT 0 CHECK (allows_customer_amount IN (0,1)),
  minimum_amount INTEGER CHECK (minimum_amount IS NULL OR minimum_amount >= 0),
  maximum_amount INTEGER CHECK (maximum_amount IS NULL OR maximum_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','UNAVAILABLE')),
  last_synced_at TEXT,
  UNIQUE(biller_id, provider_item_code)
);

-- table: branches
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  district TEXT,
  country_code TEXT NOT NULL DEFAULT 'UG',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, branch_code),
  UNIQUE(company_id, id)
);

-- table: business_expenses
CREATE TABLE business_expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  expense_reference TEXT NOT NULL,
  category_code TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('DRAFT','RECORDED','APPROVED','VOIDED')),
  idempotency_key TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, expense_reference),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, id)
);

-- table: cash_accounts
CREATE TABLE cash_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  ledger_account_id TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('CASH_DRAWER','BANK','MOBILE_MONEY','PROVIDER_FLOAT','SETTLEMENT')),
  provider_code TEXT CHECK (provider_code IS NULL OR provider_code IN ('MTN_MOMO','AIRTEL_MONEY','QUICKTELLER','INTERSWITCH','BANK')),
  account_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, ledger_account_id) REFERENCES ledger_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, account_code),
  UNIQUE(company_id, id)
);

-- table: cash_sessions
CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  cash_account_id TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  closed_by TEXT,
  opening_amount INTEGER NOT NULL CHECK (opening_amount >= 0),
  expected_closing_amount INTEGER CHECK (expected_closing_amount IS NULL OR expected_closing_amount >= 0),
  counted_closing_amount INTEGER CHECK (counted_closing_amount IS NULL OR counted_closing_amount >= 0),
  difference_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUBMITTED','APPROVED','DISPUTED','CLOSED')),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, cash_account_id) REFERENCES cash_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id)
);

-- table: commission_entries
CREATE TABLE commission_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payment_intent_id TEXT,
  agency_operation_id TEXT,
  provider_code TEXT,
  commission_type TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','EARNED','REVERSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, agency_operation_id) REFERENCES agency_operations(company_id, id) ON DELETE RESTRICT,
  CHECK ((payment_intent_id IS NOT NULL AND agency_operation_id IS NULL) OR (payment_intent_id IS NULL AND agency_operation_id IS NOT NULL))
);

-- table: companies
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  legal_name TEXT,
  country_code TEXT NOT NULL DEFAULT 'UG',
  default_currency TEXT NOT NULL DEFAULT 'UGX' CHECK (default_currency = 'UGX'),
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  status TEXT NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP','ACTIVE','SUSPENDED','CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: company_creation_requests
CREATE TABLE company_creation_requests (
  id TEXT PRIMARY KEY,
  identity_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  response_body_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identity_subject, idempotency_key)
);

-- table: customers
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_ref TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone_e164 TEXT,
  email TEXT,
  tax_identifier TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, customer_ref),
  UNIQUE(company_id, id)
);

-- table: efris_documents
CREATE TABLE efris_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL,
  invoice_number TEXT,
  fiscal_reference TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (status IN ('NOT_SUBMITTED','PENDING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
  request_fingerprint TEXT,
  response_summary TEXT,
  issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, sale_id) REFERENCES sales(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, sale_id),
  UNIQUE(company_id, invoice_number)
);

-- table: feature_flags
CREATE TABLE feature_flags (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL DEFAULT 'OPOINT',
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  rules_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_code, feature_key)
);

-- table: idempotency_records
CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  operation_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_status INTEGER,
  response_body_json TEXT,
  resource_type TEXT,
  resource_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(company_id, operation_scope, idempotency_key)
);

-- table: integration_status
CREATE TABLE integration_status (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (status IN ('NOT_CONFIGURED','CONFIGURED','PENDING_APPROVAL','ACTIVE','DEGRADED','SUSPENDED')),
  public_config_json TEXT,
  last_health_check_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider_code, environment)
);

-- table: inventory_locations
CREATE TABLE inventory_locations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, code),
  UNIQUE(company_id, id)
);

-- table: journal_entries
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  entry_number TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','REVERSED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reverses_entry_id TEXT,
  created_by TEXT NOT NULL,
  posted_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TEXT,
  FOREIGN KEY(company_id, reverses_entry_id) REFERENCES journal_entries(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, entry_number),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, source_type, source_id),
  UNIQUE(company_id, id)
);

-- table: journal_lines
CREATE TABLE journal_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  journal_entry_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  ledger_account_id TEXT NOT NULL,
  debit_amount INTEGER NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  FOREIGN KEY(company_id, journal_entry_id) REFERENCES journal_entries(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, ledger_account_id) REFERENCES ledger_accounts(company_id, id) ON DELETE RESTRICT,
  UNIQUE(journal_entry_id, line_number)
);

-- table: ledger_accounts
CREATE TABLE ledger_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, account_code),
  UNIQUE(company_id, id)
);

-- table: notification_deliveries
CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  notification_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('FCM','EMAIL','IN_APP')),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','INVALID_TOKEN')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, notification_id) REFERENCES notification_messages(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, device_id) REFERENCES notification_devices(company_id, id) ON DELETE RESTRICT,
  UNIQUE(notification_id, device_id, channel)
);

-- table: notification_devices
CREATE TABLE notification_devices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  identity_subject TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
  app_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','INVALID')),
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, token_hash),
  UNIQUE(company_id, id)
);

-- table: notification_messages
CREATE TABLE notification_messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  identity_subject TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(company_id, id)
);

-- table: opoint_schema_migrations
CREATE TABLE opoint_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: outbox_events
CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','DELIVERED','FAILED','DEAD_LETTER')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  last_error TEXT,
  UNIQUE(company_id, id)
);

-- table: payment_attempts
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payment_intent_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  request_id TEXT NOT NULL,
  provider_request_reference TEXT,
  provider_response_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  request_fingerprint TEXT NOT NULL,
  response_summary TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  UNIQUE(payment_intent_id, attempt_number),
  UNIQUE(company_id, request_id)
);

-- table: payment_intents
CREATE TABLE payment_intents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('SALE','AGENCY_OPERATION','BILL_PAYMENT','AIRTIME','DATA','OTHER')),
  source_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('COLLECTION','PAYOUT','CASH_IN','CASH_OUT','BILL_PAYMENT','AIRTIME','DATA','REFUND')),
  provider_code TEXT NOT NULL CHECK (provider_code IN ('CASH','MTN_MOMO','AIRTEL_MONEY','QUICKTELLER','INTERSWITCH','BANK','CARD')),
  provider_reference TEXT,
  external_reference TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PENDING','SUCCEEDED','FAILED','UNKNOWN','REVERSED','EXPIRED')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  customer_reference_hash TEXT,
  failure_code TEXT,
  failure_message TEXT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, id)
);

-- table: payment_reversals
CREATE TABLE payment_reversals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payment_intent_id TEXT NOT NULL,
  reversal_reference TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, reversal_reference),
  UNIQUE(company_id, idempotency_key)
);

-- table: product_categories
CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, parent_id) REFERENCES product_categories(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, name),
  UNIQUE(company_id, id)
);

-- table: products
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  category_id TEXT,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  description TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'piece',
  cost_amount INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  selling_amount INTEGER NOT NULL CHECK (selling_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0,1)),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, category_id) REFERENCES product_categories(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, sku),
  UNIQUE(company_id, id)
);

-- table: provider_webhook_inbox
CREATE TABLE provider_webhook_inbox (
  id TEXT PRIMARY KEY,
  provider_code TEXT NOT NULL CHECK (provider_code IN ('MTN_MOMO','AIRTEL_MONEY','QUICKTELLER','INTERSWITCH','BANK')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  sanitized_payload_json TEXT,
  signature_valid INTEGER NOT NULL CHECK (signature_valid IN (0,1)),
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSING','PROCESSED','REJECTED','FAILED')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  error_code TEXT,
  error_summary TEXT,
  UNIQUE(provider_code, provider_event_id)
);

-- table: purchase_order_lines
CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  purchase_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  unit_cost_amount INTEGER NOT NULL CHECK (unit_cost_amount >= 0),
  line_total_amount INTEGER NOT NULL CHECK (line_total_amount >= 0),
  FOREIGN KEY(company_id, purchase_order_id) REFERENCES purchase_orders(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, product_id) REFERENCES products(company_id, id) ON DELETE RESTRICT
);

-- table: purchase_orders
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  subtotal_amount INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, supplier_id) REFERENCES suppliers(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, order_number),
  UNIQUE(company_id, id)
);

-- table: reconciliation_items
CREATE TABLE reconciliation_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reconciliation_session_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('PAYMENT','CASH_MOVEMENT','PROVIDER_STATEMENT','BANK_STATEMENT','MANUAL')),
  source_reference TEXT NOT NULL,
  expected_amount INTEGER NOT NULL,
  observed_amount INTEGER NOT NULL,
  difference_amount INTEGER NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (resolution_status IN ('UNRESOLVED','MATCHED','EXPLAINED','DISPUTED','ADJUSTED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, reconciliation_session_id) REFERENCES reconciliation_sessions(company_id, id) ON DELETE RESTRICT,
  UNIQUE(reconciliation_session_id, source_type, source_reference)
);

-- table: reconciliation_sessions
CREATE TABLE reconciliation_sessions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  reconciliation_type TEXT NOT NULL CHECK (reconciliation_type IN ('RETAIL_CASH','PROVIDER_FLOAT','BANK','PAYMENTS')),
  provider_code TEXT,
  business_date TEXT NOT NULL,
  expected_amount INTEGER NOT NULL CHECK (expected_amount >= 0),
  counted_amount INTEGER NOT NULL CHECK (counted_amount >= 0),
  difference_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUBMITTED','APPROVED','REJECTED')),
  notes TEXT,
  prepared_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, branch_id, reconciliation_type, business_date, provider_code),
  UNIQUE(company_id, id)
);

-- table: sale_lines
CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_amount INTEGER NOT NULL CHECK (unit_price_amount >= 0),
  unit_cost_amount INTEGER NOT NULL CHECK (unit_cost_amount >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total_amount INTEGER NOT NULL CHECK (line_total_amount >= 0),
  FOREIGN KEY(company_id, sale_id) REFERENCES sales(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, product_id) REFERENCES products(company_id, id) ON DELETE RESTRICT
);

-- table: sale_payments
CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  allocated_amount INTEGER NOT NULL CHECK (allocated_amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, sale_id) REFERENCES sales(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, payment_intent_id) REFERENCES payment_intents(company_id, id) ON DELETE RESTRICT,
  UNIQUE(payment_intent_id),
  UNIQUE(company_id, id)
);

-- table: sales
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','COMPLETED','VOIDED','PARTIALLY_REFUNDED','REFUNDED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  subtotal_amount INTEGER NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  cost_amount INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, customer_id) REFERENCES customers(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, receipt_number),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, id)
);

-- table: staff_memberships
CREATE TABLE staff_memberships (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT,
  identity_subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  role_key TEXT NOT NULL CHECK (role_key IN ('OWNER','ADMIN','MANAGER','CASHIER','AGENT','ACCOUNTANT','AUDITOR')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, identity_subject),
  UNIQUE(company_id, id)
);

-- table: stock_movements
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING','PURCHASE','SALE','RETURN','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT','DAMAGE')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  unit_cost_amount INTEGER CHECK (unit_cost_amount IS NULL OR unit_cost_amount >= 0),
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, product_id) REFERENCES products(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, location_id) REFERENCES inventory_locations(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, idempotency_key)
);

-- table: stored_files
CREATE TABLE stored_files (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: suppliers
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  supplier_ref TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone_e164 TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, supplier_ref),
  UNIQUE(company_id, id)
);

-- table: system_config
CREATE TABLE system_config (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL','COMPANY','BRANCH')),
  scope_id TEXT,
  config_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_type, scope_id, config_key)
);

-- view: journal_entry_balances
CREATE VIEW journal_entry_balances AS
SELECT
  e.company_id,
  e.id AS journal_entry_id,
  e.status,
  COALESCE(SUM(l.debit_amount), 0) AS debit_total,
  COALESCE(SUM(l.credit_amount), 0) AS credit_total,
  COALESCE(SUM(l.debit_amount), 0) - COALESCE(SUM(l.credit_amount), 0) AS difference,
  COUNT(l.id) AS line_count
FROM journal_entries e
LEFT JOIN journal_lines l ON l.company_id = e.company_id AND l.journal_entry_id = e.id
GROUP BY e.company_id, e.id, e.status;

-- index: idx_agency_company_provider_created
CREATE INDEX idx_agency_company_provider_created ON agency_operations(company_id, provider_code, created_at DESC);

-- index: idx_api_rate_limits_window
CREATE INDEX idx_api_rate_limits_window ON api_rate_limits(window_start);

-- index: idx_audit_company_time
CREATE INDEX idx_audit_company_time ON audit_events(company_id, created_at DESC);

-- index: idx_company_creation_identity
CREATE INDEX idx_company_creation_identity ON company_creation_requests(identity_subject, created_at DESC);

-- index: idx_expenses_company_created
CREATE INDEX idx_expenses_company_created ON business_expenses(company_id, created_at DESC);

-- index: idx_journal_company_status_posted
CREATE INDEX idx_journal_company_status_posted ON journal_entries(company_id, status, posted_at DESC);

-- index: idx_journal_lines_entry
CREATE INDEX idx_journal_lines_entry ON journal_lines(company_id, journal_entry_id);

-- index: idx_notifications_inbox
CREATE INDEX idx_notifications_inbox ON notification_messages(company_id, identity_subject, created_at DESC);

-- index: idx_outbox_ready
CREATE INDEX idx_outbox_ready ON outbox_events(status, available_at, created_at);

-- index: idx_payments_company_status_created
CREATE INDEX idx_payments_company_status_created ON payment_intents(company_id, status, created_at DESC);

-- index: idx_payments_provider_reference
CREATE INDEX idx_payments_provider_reference ON payment_intents(provider_code, provider_reference);

-- index: idx_products_company_status_name
CREATE INDEX idx_products_company_status_name ON products(company_id, status, name);

-- index: idx_provider_inbox_status_time
CREATE INDEX idx_provider_inbox_status_time ON provider_webhook_inbox(processing_status, received_at);

-- index: idx_purchase_orders_company_status_created
CREATE INDEX idx_purchase_orders_company_status_created ON purchase_orders(company_id, status, created_at DESC);

-- index: idx_reconciliation_company_date
CREATE INDEX idx_reconciliation_company_date ON reconciliation_sessions(company_id, business_date DESC, reconciliation_type);

-- index: idx_reconciliation_items_session
CREATE INDEX idx_reconciliation_items_session ON reconciliation_items(company_id, reconciliation_session_id);

-- index: idx_sales_company_branch_created
CREATE INDEX idx_sales_company_branch_created ON sales(company_id, branch_id, created_at DESC);

-- index: idx_staff_company_status_role
CREATE INDEX idx_staff_company_status_role ON staff_memberships(company_id, status, role_key);

-- index: idx_stock_company_product_location
CREATE INDEX idx_stock_company_product_location ON stock_movements(company_id, product_id, location_id, created_at DESC);

-- trigger: trg_journal_entry_delete_posted_guard
CREATE TRIGGER trg_journal_entry_delete_posted_guard
BEFORE DELETE ON journal_entries
WHEN OLD.status='POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted_journal_entry_immutable');
END;

-- trigger: trg_journal_entry_update_posted_guard
CREATE TRIGGER trg_journal_entry_update_posted_guard
BEFORE UPDATE ON journal_entries
WHEN OLD.status='POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted_journal_entry_immutable');
END;

-- trigger: trg_journal_line_delete_posted_guard
CREATE TRIGGER trg_journal_line_delete_posted_guard
BEFORE DELETE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE company_id=OLD.company_id AND id=OLD.journal_entry_id)='POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted_journal_line_immutable');
END;

-- trigger: trg_journal_line_insert_open_only
CREATE TRIGGER trg_journal_line_insert_open_only
BEFORE INSERT ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE company_id=NEW.company_id AND id=NEW.journal_entry_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'journal_entry_not_open');
END;

-- trigger: trg_journal_line_update_posted_guard
CREATE TRIGGER trg_journal_line_update_posted_guard
BEFORE UPDATE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE company_id=OLD.company_id AND id=OLD.journal_entry_id)='POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted_journal_line_immutable');
END;

-- trigger: trg_journal_post_balance_guard
CREATE TRIGGER trg_journal_post_balance_guard
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status='POSTED' AND OLD.status<>'POSTED'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM journal_lines WHERE company_id=NEW.company_id AND journal_entry_id=NEW.id
  ) < 2 THEN RAISE(ABORT, 'journal_requires_two_lines') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(debit_amount),0)-COALESCE(SUM(credit_amount),0)
    FROM journal_lines WHERE company_id=NEW.company_id AND journal_entry_id=NEW.id
  ) <> 0 THEN RAISE(ABORT, 'journal_not_balanced') END;
END;

-- trigger: trg_sale_line_delete_completed_guard
CREATE TRIGGER trg_sale_line_delete_completed_guard
BEFORE DELETE ON sale_lines
WHEN (SELECT status FROM sales WHERE company_id=OLD.company_id AND id=OLD.sale_id)='COMPLETED'
BEGIN
  SELECT RAISE(ABORT, 'completed_sale_line_immutable');
END;

-- trigger: trg_sale_line_update_completed_guard
CREATE TRIGGER trg_sale_line_update_completed_guard
BEFORE UPDATE ON sale_lines
WHEN (SELECT status FROM sales WHERE company_id=OLD.company_id AND id=OLD.sale_id)='COMPLETED'
BEGIN
  SELECT RAISE(ABORT, 'completed_sale_line_immutable');
END;

-- trigger: trg_stock_movement_balance_guard
CREATE TRIGGER trg_stock_movement_balance_guard
BEFORE INSERT ON stock_movements
WHEN NEW.quantity_after <> (
  COALESCE((SELECT SUM(quantity_delta) FROM stock_movements
    WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND location_id=NEW.location_id),0)
  + NEW.quantity_delta
)
BEGIN
  SELECT RAISE(ABORT, 'stock_quantity_after_mismatch');
END;

-- Preserve the exact schema migration history observed in the source staging database.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at) VALUES ('0001_opoint_core', '22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224', '2026-11-11 16:06:43');
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at) VALUES ('0002_operational_hardening', '1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a', '2026-11-11 16:33:12');
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at) VALUES ('0003_financial_integrity_guards', '10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868', '2026-11-11 16:48:09');

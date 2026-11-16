-- OtyaPoint Level 1 company operations and Level 2 provider gates.
-- Additive only: no business rows, credentials, provider calls or live payments are created.
-- All monetary values are whole UGX. External provider secrets remain outside D1.

CREATE TABLE IF NOT EXISTS omni_branches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  name TEXT NOT NULL,
  district TEXT,
  town_council TEXT,
  location_label TEXT,
  public_phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, branch_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_one_primary_branch_per_company
  ON omni_branches(company_id) WHERE is_primary = 1 AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_omni_branches_company_status
  ON omni_branches(company_id, status, name);

-- Existing single-location records remain unassigned (NULL) until the owner
-- confirms the real branch mapping. Never silently move historical records.
ALTER TABLE omni_retail_sales ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_stock_movements ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_agency_transactions ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_agency_accounts ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_agency_operations ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_agency_account_movements ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_ledger_entries ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);
ALTER TABLE omni_reconciliation_sessions ADD COLUMN branch_id TEXT REFERENCES omni_branches(id);

CREATE INDEX IF NOT EXISTS idx_omni_sales_company_branch_created
  ON omni_retail_sales(company_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_agency_company_branch_status
  ON omni_agency_transactions(company_id, branch_id, provider_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_ledger_company_branch_type_date
  ON omni_ledger_entries(company_id, branch_id, ledger_type, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_reconciliation_company_branch_date
  ON omni_reconciliation_sessions(company_id, branch_id, business_date DESC, ledger_type);

-- Branch assignment is distinct from the person's general company membership.
-- One employee may have Retail and Mobile Money assignments, with different
-- duties. A product role never grants access to another product area.
CREATE TABLE IF NOT EXISTS omni_staff_work_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  staff_membership_id TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  work_area TEXT NOT NULL CHECK (work_area IN (
    'RETAIL','INVENTORY','MOBILE_MONEY','BILLS_AIRTIME','PURCHASING',
    'FINANCE','WORKFORCE','COMPLIANCE','REPORTS'
  )),
  duty_role TEXT NOT NULL CHECK (duty_role IN (
    'OPERATOR','SUPERVISOR','APPROVER','VIEWER','AUDITOR'
  )),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(id, company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_active_staff_work_assignment
  ON omni_staff_work_assignments(company_id, staff_membership_id, branch_id, work_area)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_omni_staff_work_assignment_lookup
  ON omni_staff_work_assignments(company_id, branch_id, work_area, status, duty_role);

CREATE TRIGGER IF NOT EXISTS omni_staff_work_assignment_guard
BEFORE INSERT ON omni_staff_work_assignments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    WHERE s.id = NEW.staff_membership_id
      AND s.company_id = NEW.company_id
      AND s.status = 'ACTIVE'
      AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
  ) THEN RAISE(ABORT, 'STAFF_MEMBERSHIP_OR_BRANCH_SCOPE_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id AND b.status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'BRANCH_NOT_AVAILABLE') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_staff_membership_branch_guard_insert
BEFORE INSERT ON omni_staff_memberships
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'STAFF_BRANCH_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_staff_membership_branch_guard_update
BEFORE UPDATE OF branch_id, company_id ON omni_staff_memberships
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'STAFF_BRANCH_COMPANY_MISMATCH') END;
END;

CREATE TABLE IF NOT EXISTS omni_customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, customer_code)
);
CREATE INDEX IF NOT EXISTS idx_omni_customers_company_name
  ON omni_customers(company_id, status, display_name);
CREATE INDEX IF NOT EXISTS idx_omni_customers_company_phone
  ON omni_customers(company_id, phone_number) WHERE phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS omni_suppliers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  supplier_code TEXT NOT NULL,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  phone_number TEXT,
  email TEXT,
  business_location TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, supplier_code)
);
CREATE INDEX IF NOT EXISTS idx_omni_suppliers_company_name
  ON omni_suppliers(company_id, status, business_name);

CREATE TABLE IF NOT EXISTS omni_purchase_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES omni_suppliers(id) ON DELETE RESTRICT,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_by TEXT NOT NULL,
  submitted_by TEXT,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_omni_purchase_orders_company_branch_status
  ON omni_purchase_orders(company_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_purchase_order_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES omni_purchase_orders(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES omni_products(id) ON DELETE RESTRICT,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (
    quantity_received >= 0 AND quantity_received <= quantity_ordered
  ),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(purchase_order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_omni_purchase_order_lines_order
  ON omni_purchase_order_lines(company_id, purchase_order_id);

CREATE TRIGGER IF NOT EXISTS omni_purchase_order_line_company_guard
BEFORE INSERT ON omni_purchase_order_lines
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_purchase_orders po
    JOIN omni_products p ON p.id = NEW.product_id
    WHERE po.id = NEW.purchase_order_id
      AND po.company_id = NEW.company_id
      AND p.company_id = NEW.company_id
      AND po.status = 'DRAFT'
  ) THEN RAISE(ABORT, 'PURCHASE_ORDER_PRODUCT_OR_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_purchase_order_line_update_guard
BEFORE UPDATE OF quantity_ordered, quantity_received, unit_cost, line_total ON omni_purchase_order_lines
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_purchase_orders po
    WHERE po.id = OLD.purchase_order_id AND po.company_id = OLD.company_id
      AND po.status IN ('DRAFT','SUBMITTED','PARTIALLY_RECEIVED')
  ) THEN RAISE(ABORT, 'PURCHASE_ORDER_NOT_EDITABLE') END;
  SELECT CASE WHEN NEW.quantity_received > NEW.quantity_ordered
    THEN RAISE(ABORT, 'PURCHASE_QUANTITY_RECEIVED_EXCEEDS_ORDERED') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_purchase_order_branch_guard
BEFORE INSERT ON omni_purchase_orders
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    JOIN omni_suppliers s ON s.id = NEW.supplier_id
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
      AND b.status = 'ACTIVE'
      AND s.company_id = NEW.company_id AND s.status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'PURCHASE_ORDER_SCOPE_INVALID') END;
END;

CREATE TABLE IF NOT EXISTS omni_expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  expense_reference TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH','BANK','MOBILE_MONEY','OTHER')),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID','VOIDED')),
  receipt_object_key TEXT,
  created_by TEXT NOT NULL,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  paid_by TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, expense_reference)
);
CREATE INDEX IF NOT EXISTS idx_omni_expenses_company_branch_status
  ON omni_expenses(company_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_business_compliance_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT REFERENCES omni_branches(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'COMPANY_REGISTRATION','TRADING_LICENCE','TIN_RECORD',
    'PROVIDER_AGREEMENT','BRANCH_PERMIT','TAX_DOCUMENT','OTHER'
  )),
  issuing_authority TEXT,
  display_label TEXT NOT NULL,
  reference_suffix TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','CURRENT','EXPIRING','EXPIRED','REJECTED','NOT_REQUIRED')),
  private_object_key TEXT,
  file_sha256 TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omni_compliance_company_expiry
  ON omni_business_compliance_items(company_id, status, expiry_date);

CREATE TRIGGER IF NOT EXISTS omni_compliance_branch_guard
BEFORE INSERT ON omni_business_compliance_items
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'COMPLIANCE_BRANCH_COMPANY_MISMATCH') END;
END;

CREATE TABLE IF NOT EXISTS omni_provider_connections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN (
    'MTN_MOMO','AIRTEL_MONEY','INTERSWITCH_MARKETPLACE',
    'QUICKTELLER_BUSINESS','EFRIS','AFRICASTALKING'
  )),
  capability TEXT NOT NULL CHECK (capability IN (
    'CASH_IN','CASH_OUT','AIRTIME','DATA','BILL_PAYMENT',
    'STATUS_ENQUIRY','ACCOUNT_VALIDATION','TAX_INVOICE','SMS_OTP'
  )),
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (status IN (
    'NOT_CONFIGURED','SANDBOX_READY','PENDING_PROVIDER_APPROVAL',
    'APPROVED','ACTIVE','SUSPENDED','REVOKED'
  )),
  provider_contract_ref TEXT,
  approval_evidence_ref TEXT,
  approved_by TEXT,
  approved_at TEXT,
  production_write_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (production_write_enabled IN (0,1)),
  credential_binding_name TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider, capability, environment),
  CHECK (
    production_write_enabled = 0 OR (
      environment = 'PRODUCTION'
      AND status = 'ACTIVE'
      AND provider_contract_ref IS NOT NULL AND length(provider_contract_ref) > 0
      AND approval_evidence_ref IS NOT NULL AND length(approval_evidence_ref) > 0
      AND approved_by IS NOT NULL AND length(approved_by) > 0
      AND approved_at IS NOT NULL
    )
  ),
  CHECK (
    status <> 'ACTIVE' OR environment = 'SANDBOX' OR (
      provider_contract_ref IS NOT NULL AND length(provider_contract_ref) > 0
      AND approval_evidence_ref IS NOT NULL AND length(approval_evidence_ref) > 0
      AND approved_by IS NOT NULL AND length(approved_by) > 0
      AND approved_at IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_company_status
  ON omni_provider_connections(company_id, provider, environment, status, capability);

-- Production provider writes fail closed unless all recorded approval evidence
-- is present. This stores references and state only; never credential values.
CREATE TRIGGER IF NOT EXISTS omni_provider_write_gate_insert
BEFORE INSERT ON omni_provider_connections
WHEN NEW.production_write_enabled = 1 AND (
  NEW.environment <> 'PRODUCTION' OR NEW.status <> 'ACTIVE'
  OR NEW.provider_contract_ref IS NULL OR NEW.approval_evidence_ref IS NULL
  OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCTION_PROVIDER_APPROVAL_REQUIRED');
END;
CREATE TRIGGER IF NOT EXISTS omni_provider_write_gate_update
BEFORE UPDATE OF production_write_enabled, environment, status,
  provider_contract_ref, approval_evidence_ref, approved_by, approved_at
ON omni_provider_connections
WHEN NEW.production_write_enabled = 1 AND (
  NEW.environment <> 'PRODUCTION' OR NEW.status <> 'ACTIVE'
  OR NEW.provider_contract_ref IS NULL OR NEW.approval_evidence_ref IS NULL
  OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCTION_PROVIDER_APPROVAL_REQUIRED');
END;

CREATE TABLE IF NOT EXISTS omni_staff_attendance (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  staff_membership_id TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  work_date TEXT NOT NULL,
  shift_code TEXT NOT NULL DEFAULT 'DAY',
  status TEXT NOT NULL CHECK (status IN ('PRESENT','LATE','ABSENT','ON_LEAVE','OFF_DAY')),
  clock_in_at TEXT,
  clock_out_at TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, branch_id, staff_membership_id, work_date, shift_code)
);
CREATE INDEX IF NOT EXISTS idx_omni_attendance_company_date
  ON omni_staff_attendance(company_id, branch_id, work_date DESC, status);

CREATE TRIGGER IF NOT EXISTS omni_attendance_scope_guard
BEFORE INSERT ON omni_staff_attendance
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    JOIN omni_branches b ON b.id = NEW.branch_id
    WHERE s.id = NEW.staff_membership_id
      AND s.company_id = NEW.company_id
      AND s.status = 'ACTIVE'
      AND b.company_id = NEW.company_id
      AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
  ) THEN RAISE(ABORT, 'ATTENDANCE_SCOPE_INVALID') END;
END;

CREATE TABLE IF NOT EXISTS omni_leave_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  staff_membership_id TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('ANNUAL','PERSONAL','UNPAID','OTHER')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','CANCELLED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_omni_leave_company_staff_dates
  ON omni_leave_requests(company_id, staff_membership_id, start_date, end_date, status);

CREATE TRIGGER IF NOT EXISTS omni_leave_scope_guard
BEFORE INSERT ON omni_leave_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    JOIN omni_branches b ON b.id = NEW.branch_id
    WHERE s.id = NEW.staff_membership_id
      AND s.company_id = NEW.company_id
      AND s.status = 'ACTIVE'
      AND b.company_id = NEW.company_id
      AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
  ) THEN RAISE(ABORT, 'LEAVE_SCOPE_INVALID') END;
END;

-- Branch stock is a new ledger. Existing omni_products.quantity_on_hand values
-- remain unchanged until an owner-reviewed opening-stock allocation is approved.
CREATE TABLE IF NOT EXISTS omni_branch_stock (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES omni_products(id) ON DELETE RESTRICT,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, branch_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_omni_branch_stock_company_branch
  ON omni_branch_stock(company_id, branch_id, quantity_on_hand, reorder_level);

CREATE TABLE IF NOT EXISTS omni_branch_stock_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES omni_products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'OPENING','PURCHASE','SALE','TRANSFER_IN','TRANSFER_OUT','RETURN','ADJUSTMENT','DAMAGE'
  )),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_omni_branch_stock_movements_history
  ON omni_branch_stock_movements(company_id, branch_id, product_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS omni_branch_stock_movement_guard
BEFORE INSERT ON omni_branch_stock_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b
    JOIN omni_products p ON p.id = NEW.product_id
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
      AND b.status = 'ACTIVE' AND p.company_id = NEW.company_id AND p.is_active = 1
  ) THEN RAISE(ABORT, 'BRANCH_STOCK_SCOPE_INVALID') END;
  SELECT CASE WHEN NEW.quantity_after <> (
    SELECT COALESCE(s.quantity_on_hand, 0) + NEW.quantity_delta
    FROM omni_branch_stock s
    WHERE s.company_id = NEW.company_id
      AND s.branch_id = NEW.branch_id
      AND s.product_id = NEW.product_id
  ) AND NOT (
    NOT EXISTS (
      SELECT 1 FROM omni_branch_stock s
      WHERE s.company_id = NEW.company_id
        AND s.branch_id = NEW.branch_id
        AND s.product_id = NEW.product_id
    ) AND NEW.quantity_delta > 0 AND NEW.quantity_after = NEW.quantity_delta
  ) THEN RAISE(ABORT, 'BRANCH_STOCK_BALANCE_CONFLICT') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_stock_movement_apply
AFTER INSERT ON omni_branch_stock_movements
BEGIN
  INSERT INTO omni_branch_stock (
    id, company_id, branch_id, product_id, quantity_on_hand, reorder_level
  ) VALUES (
    lower(hex(randomblob(16))), NEW.company_id, NEW.branch_id, NEW.product_id, NEW.quantity_after, 0
  )
  ON CONFLICT(company_id, branch_id, product_id)
  DO UPDATE SET quantity_on_hand = NEW.quantity_after, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_stock_movements_no_update
BEFORE UPDATE ON omni_branch_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'BRANCH_STOCK_MOVEMENT_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_branch_stock_movements_no_delete
BEFORE DELETE ON omni_branch_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'BRANCH_STOCK_MOVEMENT_APPEND_ONLY');
END;

-- Existing records can remain company-wide (NULL branch_id) during transition.
-- New branch-assigned records must reference a branch owned by the same company.
CREATE TRIGGER IF NOT EXISTS omni_sales_branch_guard
BEFORE INSERT ON omni_retail_sales
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'SALES_BRANCH_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_stock_movements_branch_guard
BEFORE INSERT ON omni_stock_movements
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'STOCK_BRANCH_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_agency_transactions_branch_guard
BEFORE INSERT ON omni_agency_transactions
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'AGENCY_BRANCH_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_ledger_entries_branch_guard
BEFORE INSERT ON omni_ledger_entries
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'LEDGER_BRANCH_COMPANY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS omni_reconciliation_branch_guard
BEFORE INSERT ON omni_reconciliation_sessions
WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'RECONCILIATION_BRANCH_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_expense_branch_guard
BEFORE INSERT ON omni_expenses
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN RAISE(ABORT, 'EXPENSE_BRANCH_COMPANY_MISMATCH') END;
END;

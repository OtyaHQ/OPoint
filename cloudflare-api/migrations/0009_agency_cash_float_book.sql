-- OtyaPoint local cash-and-float book.
-- This is an additive, source-only migration. It does not create provider connections
-- or change the existing provider transaction table.
CREATE TABLE IF NOT EXISTS omni_agency_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('CASH_DRAWER','PROVIDER_FLOAT')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('MTN_MOMO','AIRTEL_MONEY')),
  account_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  current_balance INTEGER NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, account_code),
  UNIQUE(company_id, idempotency_key),
  CHECK (
    (account_type = 'CASH_DRAWER' AND provider IS NULL AND account_code = 'AGENCY_CASH_DRAWER')
    OR
    (account_type = 'PROVIDER_FLOAT' AND provider = 'MTN_MOMO' AND account_code = 'AGENCY_FLOAT_MTN_MOMO')
    OR
    (account_type = 'PROVIDER_FLOAT' AND provider = 'AIRTEL_MONEY' AND account_code = 'AGENCY_FLOAT_AIRTEL_MONEY')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_agency_one_active_cash_drawer
  ON omni_agency_accounts(company_id)
  WHERE account_type = 'CASH_DRAWER' AND status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_agency_one_active_provider_float
  ON omni_agency_accounts(company_id, provider)
  WHERE account_type = 'PROVIDER_FLOAT' AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_omni_agency_accounts_company_status
  ON omni_agency_accounts(company_id, status, account_type);

CREATE TABLE IF NOT EXISTS omni_agency_operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('CASH_IN','CASH_OUT')),
  provider TEXT NOT NULL CHECK (provider IN ('MTN_MOMO','AIRTEL_MONEY')),
  provider_reference TEXT NOT NULL CHECK (length(provider_reference) BETWEEN 3 AND 120),
  customer_reference_last4 TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  cash_account_id TEXT NOT NULL REFERENCES omni_agency_accounts(id) ON DELETE RESTRICT,
  float_account_id TEXT NOT NULL REFERENCES omni_agency_accounts(id) ON DELETE RESTRICT,
  recording_status TEXT NOT NULL DEFAULT 'OPERATOR_RECORDED_UNVERIFIED'
    CHECK (recording_status = 'OPERATOR_RECORDED_UNVERIFIED'),
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, reference),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, provider, provider_reference),
  CHECK (cash_account_id <> float_account_id),
  CHECK (customer_reference_last4 IS NULL OR length(customer_reference_last4) = 4)
);
CREATE INDEX IF NOT EXISTS idx_omni_agency_operations_company_created
  ON omni_agency_operations(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_agency_operations_company_status
  ON omni_agency_operations(company_id, recording_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_agency_operations_actor_created
  ON omni_agency_operations(company_id, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS omni_agency_account_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES omni_agency_accounts(id) ON DELETE RESTRICT,
  operation_id TEXT REFERENCES omni_agency_operations(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING_BALANCE','CASH_IN','CASH_OUT')),
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_omni_agency_movements_account_created
  ON omni_agency_account_movements(company_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_agency_movements_operation
  ON omni_agency_account_movements(operation_id);

-- An opening balance is allowed only once when an account is created at zero.
-- Operational movements must be a valid leg of a company-scoped operator record.
CREATE TRIGGER IF NOT EXISTS omni_agency_account_movement_guard
BEFORE INSERT ON omni_agency_account_movements
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM omni_agency_accounts a
       WHERE a.id = NEW.account_id
         AND a.company_id = NEW.company_id
         AND a.status = 'ACTIVE'
    ) THEN RAISE(ABORT, 'AGENCY_ACCOUNT_NOT_AVAILABLE')
  END;
  SELECT CASE
    WHEN NEW.balance_after != (
      SELECT current_balance + CASE WHEN NEW.direction = 'IN' THEN NEW.amount ELSE -NEW.amount END
        FROM omni_agency_accounts WHERE id = NEW.account_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'AGENCY_ACCOUNT_BALANCE_CONFLICT')
  END;
  SELECT CASE
    WHEN NEW.movement_type = 'OPENING_BALANCE'
     AND (NEW.operation_id IS NOT NULL OR NEW.direction <> 'IN'
          OR (SELECT current_balance FROM omni_agency_accounts WHERE id = NEW.account_id) <> 0)
    THEN RAISE(ABORT, 'AGENCY_OPENING_BALANCE_INVALID')
  END;
  SELECT CASE
    WHEN NEW.movement_type <> 'OPENING_BALANCE'
     AND NOT EXISTS (
       SELECT 1 FROM omni_agency_operations o
        WHERE o.id = NEW.operation_id
          AND o.company_id = NEW.company_id
          AND o.transaction_type = NEW.movement_type
          AND (
            (NEW.account_id = o.cash_account_id AND
              ((o.transaction_type = 'CASH_IN' AND NEW.direction = 'IN') OR
               (o.transaction_type = 'CASH_OUT' AND NEW.direction = 'OUT')))
            OR
            (NEW.account_id = o.float_account_id AND
              ((o.transaction_type = 'CASH_IN' AND NEW.direction = 'OUT') OR
               (o.transaction_type = 'CASH_OUT' AND NEW.direction = 'IN')))
          )
     )
    THEN RAISE(ABORT, 'AGENCY_OPERATION_MOVEMENT_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS omni_agency_account_movement_apply
AFTER INSERT ON omni_agency_account_movements
BEGIN
  UPDATE omni_agency_accounts
     SET current_balance = NEW.balance_after,
         updated_at = CURRENT_TIMESTAMP
   WHERE id = NEW.account_id AND company_id = NEW.company_id;
END;

CREATE TRIGGER IF NOT EXISTS omni_agency_operations_guard
BEFORE INSERT ON omni_agency_operations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_agency_accounts
     WHERE id = NEW.cash_account_id AND company_id = NEW.company_id
       AND account_type = 'CASH_DRAWER' AND provider IS NULL AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'AGENCY_CASH_ACCOUNT_NOT_AVAILABLE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_agency_accounts
     WHERE id = NEW.float_account_id AND company_id = NEW.company_id
       AND account_type = 'PROVIDER_FLOAT' AND provider = NEW.provider AND status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'AGENCY_FLOAT_ACCOUNT_NOT_AVAILABLE') END;
END;

-- Operator-reported business records and their account/ledger movements are immutable.
-- Future reversals or reconciliation corrections must append compensating records.
CREATE TRIGGER IF NOT EXISTS omni_agency_operations_no_update
BEFORE UPDATE ON omni_agency_operations
BEGIN
  SELECT RAISE(ABORT, 'AGENCY_OPERATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_agency_operations_no_delete
BEFORE DELETE ON omni_agency_operations
BEGIN
  SELECT RAISE(ABORT, 'AGENCY_OPERATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_agency_account_movements_no_update
BEFORE UPDATE ON omni_agency_account_movements
BEGIN
  SELECT RAISE(ABORT, 'AGENCY_ACCOUNT_MOVEMENT_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_agency_account_movements_no_delete
BEFORE DELETE ON omni_agency_account_movements
BEGIN
  SELECT RAISE(ABORT, 'AGENCY_ACCOUNT_MOVEMENT_APPEND_ONLY');
END;

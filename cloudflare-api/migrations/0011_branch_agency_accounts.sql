-- Branch-scoped Mobile Money agency account book.
-- Operator-recorded entries are explicitly unverified; this schema never calls a provider.
CREATE TABLE IF NOT EXISTS omni_branch_agency_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  account_type TEXT NOT NULL CHECK (account_type IN ('CASH_DRAWER','PROVIDER_FLOAT')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('MTN_MOMO','AIRTEL_MONEY')),
  account_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency='UGX'),
  current_balance INTEGER NOT NULL DEFAULT 0 CHECK (current_balance>=0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id,idempotency_key),
  CHECK (
    (account_type='CASH_DRAWER' AND provider IS NULL AND account_code='BRANCH_AGENCY_CASH')
    OR
    (account_type='PROVIDER_FLOAT' AND provider='MTN_MOMO' AND account_code='BRANCH_FLOAT_MTN')
    OR
    (account_type='PROVIDER_FLOAT' AND provider='AIRTEL_MONEY' AND account_code='BRANCH_FLOAT_AIRTEL')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_branch_agency_one_cash
  ON omni_branch_agency_accounts(company_id,branch_id)
  WHERE account_type='CASH_DRAWER' AND status='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_branch_agency_one_float_provider
  ON omni_branch_agency_accounts(company_id,branch_id,provider)
  WHERE account_type='PROVIDER_FLOAT' AND status='ACTIVE';
CREATE INDEX IF NOT EXISTS idx_omni_branch_agency_accounts_lookup
  ON omni_branch_agency_accounts(company_id,branch_id,status,account_type);

CREATE TABLE IF NOT EXISTS omni_branch_agency_operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES omni_branches(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('CASH_IN','CASH_OUT')),
  provider TEXT NOT NULL CHECK (provider IN ('MTN_MOMO','AIRTEL_MONEY')),
  provider_reference TEXT NOT NULL CHECK (length(provider_reference) BETWEEN 3 AND 120),
  customer_reference_last4 TEXT CHECK (customer_reference_last4 IS NULL OR length(customer_reference_last4)=4),
  amount INTEGER NOT NULL CHECK (amount>0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency='UGX'),
  cash_account_id TEXT NOT NULL REFERENCES omni_branch_agency_accounts(id) ON DELETE RESTRICT,
  float_account_id TEXT NOT NULL REFERENCES omni_branch_agency_accounts(id) ON DELETE RESTRICT,
  recording_status TEXT NOT NULL DEFAULT 'OPERATOR_RECORDED_UNVERIFIED'
    CHECK (recording_status='OPERATOR_RECORDED_UNVERIFIED'),
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id,branch_id,reference),
  UNIQUE(company_id,branch_id,idempotency_key),
  UNIQUE(company_id,provider,provider_reference),
  CHECK(cash_account_id<>float_account_id)
);
CREATE INDEX IF NOT EXISTS idx_omni_branch_agency_operations_history
  ON omni_branch_agency_operations(company_id,branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_branch_agency_operations_actor
  ON omni_branch_agency_operations(company_id,branch_id,actor_id,created_at DESC);

CREATE TABLE IF NOT EXISTS omni_branch_agency_account_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES omni_branch_agency_accounts(id) ON DELETE RESTRICT,
  operation_id TEXT REFERENCES omni_branch_agency_operations(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('OPENING_BALANCE','CASH_IN','CASH_OUT')),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount INTEGER NOT NULL CHECK(amount>0),
  balance_after INTEGER NOT NULL CHECK(balance_after>=0),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_omni_branch_agency_movements_history
  ON omni_branch_agency_account_movements(company_id,branch_id,account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omni_branch_agency_movements_operation
  ON omni_branch_agency_account_movements(operation_id);

CREATE TRIGGER IF NOT EXISTS omni_branch_agency_account_guard
BEFORE INSERT ON omni_branch_agency_accounts
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM omni_branches b
     WHERE b.id=NEW.branch_id AND b.company_id=NEW.company_id AND b.status='ACTIVE'
  ) THEN RAISE(ABORT,'BRANCH_AGENCY_BRANCH_NOT_AVAILABLE') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_agency_movement_guard
BEFORE INSERT ON omni_branch_agency_account_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM omni_branch_agency_accounts a
     WHERE a.id=NEW.account_id AND a.company_id=NEW.company_id
       AND a.branch_id=NEW.branch_id AND a.status='ACTIVE'
  ) THEN RAISE(ABORT,'BRANCH_AGENCY_ACCOUNT_NOT_AVAILABLE') END;
  SELECT CASE WHEN NEW.balance_after != (
    SELECT current_balance + CASE WHEN NEW.direction='IN' THEN NEW.amount ELSE -NEW.amount END
      FROM omni_branch_agency_accounts
     WHERE id=NEW.account_id AND company_id=NEW.company_id AND branch_id=NEW.branch_id
  ) THEN RAISE(ABORT,'BRANCH_AGENCY_BALANCE_CONFLICT') END;
  SELECT CASE WHEN NEW.movement_type='OPENING_BALANCE'
    AND (NEW.operation_id IS NOT NULL OR NEW.direction<>'IN'
         OR (SELECT current_balance FROM omni_branch_agency_accounts
              WHERE id=NEW.account_id AND company_id=NEW.company_id AND branch_id=NEW.branch_id)<>0)
    THEN RAISE(ABORT,'BRANCH_AGENCY_OPENING_BALANCE_INVALID') END;
  SELECT CASE WHEN NEW.movement_type<>'OPENING_BALANCE'
    AND NOT EXISTS(
      SELECT 1 FROM omni_branch_agency_operations o
       WHERE o.id=NEW.operation_id AND o.company_id=NEW.company_id AND o.branch_id=NEW.branch_id
         AND o.transaction_type=NEW.movement_type
         AND (
           (NEW.account_id=o.cash_account_id AND
             ((o.transaction_type='CASH_IN' AND NEW.direction='IN') OR
              (o.transaction_type='CASH_OUT' AND NEW.direction='OUT')))
           OR
           (NEW.account_id=o.float_account_id AND
             ((o.transaction_type='CASH_IN' AND NEW.direction='OUT') OR
              (o.transaction_type='CASH_OUT' AND NEW.direction='IN')))
         )
    ) THEN RAISE(ABORT,'BRANCH_AGENCY_OPERATION_MOVEMENT_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_agency_movement_apply
AFTER INSERT ON omni_branch_agency_account_movements
BEGIN
  UPDATE omni_branch_agency_accounts
     SET current_balance=NEW.balance_after,updated_at=CURRENT_TIMESTAMP
   WHERE id=NEW.account_id AND company_id=NEW.company_id AND branch_id=NEW.branch_id;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_agency_operation_guard
BEFORE INSERT ON omni_branch_agency_operations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM omni_branch_agency_accounts
     WHERE id=NEW.cash_account_id AND company_id=NEW.company_id AND branch_id=NEW.branch_id
       AND account_type='CASH_DRAWER' AND provider IS NULL AND status='ACTIVE'
  ) THEN RAISE(ABORT,'BRANCH_AGENCY_CASH_ACCOUNT_NOT_AVAILABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM omni_branch_agency_accounts
     WHERE id=NEW.float_account_id AND company_id=NEW.company_id AND branch_id=NEW.branch_id
       AND account_type='PROVIDER_FLOAT' AND provider=NEW.provider AND status='ACTIVE'
  ) THEN RAISE(ABORT,'BRANCH_AGENCY_FLOAT_ACCOUNT_NOT_AVAILABLE') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_branch_agency_operations_no_update
BEFORE UPDATE ON omni_branch_agency_operations
BEGIN
  SELECT RAISE(ABORT,'BRANCH_AGENCY_OPERATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_branch_agency_operations_no_delete
BEFORE DELETE ON omni_branch_agency_operations
BEGIN
  SELECT RAISE(ABORT,'BRANCH_AGENCY_OPERATION_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_branch_agency_movements_no_update
BEFORE UPDATE ON omni_branch_agency_account_movements
BEGIN
  SELECT RAISE(ABORT,'BRANCH_AGENCY_MOVEMENT_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_branch_agency_movements_no_delete
BEFORE DELETE ON omni_branch_agency_account_movements
BEGIN
  SELECT RAISE(ABORT,'BRANCH_AGENCY_MOVEMENT_APPEND_ONLY');
END;

-- OtyaPoint provider-agent account separation.
-- Provider accounts belong to a company branch and provider, not to an employee identity.
-- Staff are separately assigned to an approved provider account.
-- Never store customer/staff PINs, OTPs, provider passwords, API tokens or raw KYC documents.

CREATE TABLE provider_agent_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  provider_code TEXT NOT NULL CHECK (provider_code IN ('MTN_MOMO','AIRTEL_MONEY')),
  provider_agent_reference TEXT NOT NULL CHECK (length(provider_agent_reference) BETWEEN 3 AND 120),
  display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 2 AND 100),
  agent_line_last4 TEXT CHECK (agent_line_last4 IS NULL OR (length(agent_line_last4) = 4 AND agent_line_last4 NOT GLOB '*[^0-9]*')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  provider_approval_reference TEXT,
  provider_approved_at TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, id, branch_id),
  UNIQUE(company_id, provider_code, provider_agent_reference),
  UNIQUE(company_id, idempotency_key),
  CHECK (status <> 'ACTIVE' OR
    (provider_approval_reference IS NOT NULL AND length(provider_approval_reference) >= 4 AND provider_approved_at IS NOT NULL))
);

CREATE INDEX idx_provider_agent_accounts_branch_status
  ON provider_agent_accounts(company_id, branch_id, status, provider_code);

CREATE TABLE provider_agent_account_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_agent_account_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED','ACTIVATED','SUSPENDED','REACTIVATED','REVOKED')),
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, provider_agent_account_id)
    REFERENCES provider_agent_accounts(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_provider_agent_account_events_history
  ON provider_agent_account_events(company_id, provider_agent_account_id, created_at DESC);

CREATE TRIGGER provider_agent_account_events_no_update
BEFORE UPDATE ON provider_agent_account_events
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_AGENT_ACCOUNT_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER provider_agent_account_events_no_delete
BEFORE DELETE ON provider_agent_account_events
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_AGENT_ACCOUNT_EVENTS_APPEND_ONLY');
END;

CREATE TABLE provider_agent_staff_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_agent_account_id TEXT NOT NULL,
  staff_membership_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  duty_role TEXT NOT NULL CHECK (duty_role IN ('OPERATOR','SUPERVISOR','APPROVER','VIEWER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suspended_by TEXT,
  suspended_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  FOREIGN KEY(company_id, provider_agent_account_id, branch_id)
    REFERENCES provider_agent_accounts(company_id, id, branch_id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, staff_membership_id)
    REFERENCES staff_memberships(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, branch_id)
    REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  UNIQUE(company_id, idempotency_key),
  CHECK ((status = 'SUSPENDED' AND suspended_by IS NOT NULL AND suspended_at IS NOT NULL)
      OR status <> 'SUSPENDED'),
  CHECK ((status = 'REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
      OR status <> 'REVOKED')
);

CREATE UNIQUE INDEX idx_provider_agent_staff_one_active
  ON provider_agent_staff_assignments(company_id, provider_agent_account_id, staff_membership_id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_provider_agent_staff_membership
  ON provider_agent_staff_assignments(company_id, staff_membership_id, status, branch_id);

CREATE TABLE provider_agent_staff_assignment_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  assignment_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED','SUSPENDED','RESUMED','REVOKED')),
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, assignment_id)
    REFERENCES provider_agent_staff_assignments(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_provider_agent_staff_events_history
  ON provider_agent_staff_assignment_events(company_id, assignment_id, created_at DESC);

CREATE TRIGGER provider_agent_staff_events_no_update
BEFORE UPDATE ON provider_agent_staff_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_AGENT_STAFF_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER provider_agent_staff_events_no_delete
BEFORE DELETE ON provider_agent_staff_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_AGENT_STAFF_EVENTS_APPEND_ONLY');
END;

-- Migration checksum covers the DDL above and excludes this ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0005_provider_agent_accounts', 'd97fbd385f94cd52607d2f25845dee58b80de1941aabc476d71275eeae3719c2', CURRENT_TIMESTAMP);

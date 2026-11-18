-- OtyaPoint branch-scoped work-area permissions.
-- Apply only as a forward migration to the isolated OtyaPoint staging D1 database.
-- Each person can have separate Retail and Mobile Money assignments at a branch.
-- This migration adds permissions and classifies cash accounts; it does not move funds.

ALTER TABLE cash_accounts
  ADD COLUMN work_area TEXT NOT NULL DEFAULT 'RETAIL'
  CHECK (work_area IN ('RETAIL','MOBILE_MONEY'));

-- Provider floats for Airtel/MTN are agency-owned accounts; classify them separately.
-- Do not infer or migrate cash drawers: an agency cash drawer must be explicitly assigned.
UPDATE cash_accounts
   SET work_area = 'MOBILE_MONEY'
 WHERE account_type IN ('MOBILE_MONEY','PROVIDER_FLOAT')
    OR provider_code IN ('MTN_MOMO','AIRTEL_MONEY');

CREATE TABLE IF NOT EXISTS staff_work_assignments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  staff_membership_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  work_area TEXT NOT NULL CHECK (work_area IN ('RETAIL','MOBILE_MONEY')),
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_work_assignment_one_active_area
  ON staff_work_assignments(company_id, staff_membership_id, branch_id, work_area)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_staff_work_assignments_membership
  ON staff_work_assignments(company_id, staff_membership_id, status, branch_id, work_area);

CREATE INDEX IF NOT EXISTS idx_staff_work_assignments_branch
  ON staff_work_assignments(company_id, branch_id, work_area, status, duty_role);

CREATE TABLE IF NOT EXISTS staff_work_assignment_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  assignment_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED','SUSPENDED','RESUMED','REVOKED')),
  previous_status TEXT,
  new_status TEXT NOT NULL
    CHECK (new_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, assignment_id)
    REFERENCES staff_work_assignments(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_staff_work_assignment_events_assignment
  ON staff_work_assignment_events(company_id, assignment_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS staff_work_assignment_events_no_update
BEFORE UPDATE ON staff_work_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'STAFF_WORK_ASSIGNMENT_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS staff_work_assignment_events_no_delete
BEFORE DELETE ON staff_work_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'STAFF_WORK_ASSIGNMENT_EVENTS_APPEND_ONLY');
END;

-- The checksum covers the SQL migration body above, excluding this ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0004_staff_work_assignments', 'fa3666d4eb0e62322800d5b9f0e9b762d24851b282fd01a7c20a4f1eed3a9090', CURRENT_TIMESTAMP);

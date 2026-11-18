-- OtyaPoint one-use, email-bound staff invitations.
-- Invitations are separate from memberships because a person must first sign in
-- with Otya ID and redeem the emailed token. Acceptance creates a PENDING membership;
-- an Owner/Admin must activate it before operational access is granted.

CREATE TABLE IF NOT EXISTS staff_invitations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  branch_id TEXT,
  role_key TEXT NOT NULL CHECK (role_key IN ('ADMIN','MANAGER','CASHIER','AGENT','ACCOUNTANT','AUDITOR')),
  token_digest TEXT NOT NULL UNIQUE
    CHECK (length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  delivery_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING','SENT','FAILED')),
  invited_by TEXT NOT NULL,
  accepted_membership_id TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, invited_by)
    REFERENCES staff_memberships(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, branch_id)
    REFERENCES branches(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, accepted_membership_id)
    REFERENCES staff_memberships(company_id, id) ON DELETE RESTRICT,
  UNIQUE(company_id, id),
  CHECK (email_normalized = lower(trim(email_normalized))),
  CHECK (length(trim(email)) BETWEEN 3 AND 254),
  CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  CHECK (status <> 'ACCEPTED' OR (accepted_membership_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_one_pending_email
  ON staff_invitations(company_id, email_normalized)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_staff_invitations_company_status_created
  ON staff_invitations(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_invitation_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invitation_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED','EMAIL_SENT','EMAIL_FAILED','ACCEPTED','REVOKED','EXPIRED')),
  previous_status TEXT,
  new_status TEXT,
  actor_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, invitation_id)
    REFERENCES staff_invitations(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_invitation_events_timeline
  ON staff_invitation_events(company_id, invitation_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS staff_invitations_terminal_status_guard
BEFORE UPDATE OF status ON staff_invitations
WHEN OLD.status <> 'PENDING' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'STAFF_INVITATION_TERMINAL');
END;

CREATE TRIGGER IF NOT EXISTS staff_invitations_core_fields_immutable
BEFORE UPDATE OF company_id, email, email_normalized, display_name, branch_id,
  role_key, token_digest, invited_by, expires_at, created_at
ON staff_invitations
WHEN NEW.company_id IS NOT OLD.company_id
  OR NEW.email IS NOT OLD.email
  OR NEW.email_normalized IS NOT OLD.email_normalized
  OR NEW.display_name IS NOT OLD.display_name
  OR NEW.branch_id IS NOT OLD.branch_id
  OR NEW.role_key IS NOT OLD.role_key
  OR NEW.token_digest IS NOT OLD.token_digest
  OR NEW.invited_by IS NOT OLD.invited_by
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'STAFF_INVITATION_CORE_FIELDS_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS staff_invitations_delivery_transition_guard
BEFORE UPDATE OF delivery_status ON staff_invitations
WHEN NEW.delivery_status <> OLD.delivery_status
  AND NOT (OLD.delivery_status = 'PENDING' AND NEW.delivery_status IN ('SENT','FAILED'))
BEGIN
  SELECT RAISE(ABORT, 'STAFF_INVITATION_DELIVERY_TERMINAL');
END;

CREATE TRIGGER IF NOT EXISTS staff_invitations_acceptance_guard
BEFORE UPDATE OF status ON staff_invitations
WHEN NEW.status = 'ACCEPTED'
BEGIN
  SELECT CASE WHEN NEW.accepted_membership_id IS NULL OR NEW.accepted_at IS NULL
    THEN RAISE(ABORT, 'STAFF_INVITATION_ACCEPTANCE_METADATA_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM staff_memberships sm
     WHERE sm.company_id = NEW.company_id
       AND sm.id = NEW.accepted_membership_id
       AND sm.status = 'PENDING'
       AND sm.role_key = NEW.role_key
       AND lower(trim(COALESCE(sm.email,''))) = NEW.email_normalized
  ) THEN RAISE(ABORT, 'STAFF_INVITATION_ACCEPTANCE_MEMBERSHIP_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS staff_invitation_events_no_update
BEFORE UPDATE ON staff_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'STAFF_INVITATION_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS staff_invitation_events_no_delete
BEFORE DELETE ON staff_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'STAFF_INVITATION_EVENTS_APPEND_ONLY');
END;

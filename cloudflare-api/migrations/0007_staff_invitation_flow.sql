-- One-time, email-bound invitations to OtyaPoint staff memberships.
-- Token values are never stored; only SHA-256 digests are persisted.
CREATE TABLE omni_staff_invitations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  branch_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('ATTENDANT','MANAGER','MANAGING_DIRECTOR','CHAIRMAN')),
  agent_id TEXT,
  token_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  delivery_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING','SENT','FAILED')),
  invited_by TEXT NOT NULL REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  accepted_staff_id TEXT REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_omni_staff_invitation_pending_email
  ON omni_staff_invitations(company_id, lower(email))
  WHERE status = 'PENDING';

CREATE INDEX idx_omni_staff_invitation_company_status
  ON omni_staff_invitations(company_id, status, created_at DESC);

CREATE INDEX idx_omni_staff_invitation_expiry
  ON omni_staff_invitations(status, expires_at);

-- The API marks invitation-originated membership inserts with the invitation ID
-- and presented token digest. This trigger prevents a stale/revoked/rotated code
-- from creating a membership even if the API read occurred before another write.
CREATE TRIGGER omni_staff_invitation_membership_guard
BEFORE INSERT ON omni_staff_memberships
WHEN NEW.created_by LIKE 'staff-invitation:%'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM omni_staff_invitations invitation
    WHERE invitation.id = substr(NEW.created_by, 18, 36)
      AND invitation.token_digest = substr(NEW.created_by, 55)
      AND invitation.company_id = NEW.company_id
      AND invitation.status = 'PENDING'
      AND datetime(invitation.expires_at) > CURRENT_TIMESTAMP
  ) THEN RAISE(ABORT, 'STAFF_INVITATION_NOT_PENDING') END;
END;

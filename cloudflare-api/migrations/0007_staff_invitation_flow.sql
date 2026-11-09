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

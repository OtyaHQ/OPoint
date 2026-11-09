-- Enforce exactly one active sovereign owner per company and consume the
-- one-time owner bootstrap durably in the audit stream.
-- Existing memberships are preserved; no owner is created by this migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_one_active_sovereign_per_company
  ON omni_staff_memberships(company_id)
  WHERE role = 'SOVEREIGN' AND status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_owner_bootstrap_once
  ON omni_audit_events(company_id)
  WHERE action = 'BOOTSTRAP_OWNER';

CREATE INDEX IF NOT EXISTS idx_omni_staff_company_status_role
  ON omni_staff_memberships(company_id, status, role, created_at);

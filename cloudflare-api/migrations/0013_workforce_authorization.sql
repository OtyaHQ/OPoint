-- Otya workforce authorization enforcement and provider-specific KYC separation.
-- Additive/source-only. Do not apply to any remote database without a separate,
-- reviewed migration plan, backup and explicit release approval.

INSERT OR IGNORE INTO omni_permission_catalog(permission_key,description,sensitive) VALUES
  ('identity.kyc.read','View restricted employee/provider KYC verification status',1),
  ('identity.kyc.manage','Record or update provider KYC verification evidence',1),
  ('providers.operate','Use an approved provider account for assigned teller operations',1),
  ('sims.assign','Assign or return company SIM cards',1),
  ('devices.assign','Assign or return company devices',1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_permission_grant_active_unique
  ON omni_staff_permission_grants(
    company_id, staff_membership_id, permission_key, scope_type, COALESCE(scope_id,'')
  )
  WHERE status = 'ACTIVE';

CREATE TRIGGER IF NOT EXISTS omni_staff_permission_grant_scope_guard
BEFORE INSERT ON omni_staff_permission_grants
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships m
     WHERE m.id=NEW.staff_membership_id AND m.company_id=NEW.company_id AND m.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_GRANT_STAFF_SCOPE_MISMATCH') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships actor
     WHERE actor.id=NEW.granted_by AND actor.company_id=NEW.company_id AND actor.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_GRANT_ACTOR_SCOPE_MISMATCH') END;

  SELECT CASE WHEN NEW.scope_type='COMPANY' AND NEW.scope_id IS NOT NULL
    THEN RAISE(ABORT, 'PERMISSION_COMPANY_SCOPE_ID_NOT_ALLOWED') END;

  SELECT CASE WHEN NEW.scope_type='SELF' AND NEW.scope_id <> NEW.staff_membership_id
    THEN RAISE(ABORT, 'PERMISSION_SELF_SCOPE_MISMATCH') END;

  SELECT CASE WHEN NEW.scope_type='OUTLET' AND NOT EXISTS (
    SELECT 1
      FROM omni_enterprise_employees e
      JOIN omni_employee_outlet_assignments a ON a.employee_id=e.id AND a.company_id=e.company_id
      JOIN omni_enterprise_outlets o ON o.id=a.outlet_id AND o.company_id=a.company_id
     WHERE e.staff_membership_id=NEW.staff_membership_id
       AND e.company_id=NEW.company_id
       AND e.employment_status='ACTIVE'
       AND a.outlet_id=NEW.scope_id
       AND a.status='ACTIVE'
       AND datetime(a.starts_at) <= datetime(NEW.starts_at)
       AND (a.ends_at IS NULL OR datetime(a.ends_at) > datetime(NEW.starts_at))
       AND o.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_OUTLET_ASSIGNMENT_REQUIRED') END;

  SELECT CASE WHEN NEW.scope_type='PROVIDER_ACCOUNT' AND NOT EXISTS (
    SELECT 1
      FROM omni_enterprise_employees e
      JOIN omni_provider_operator_profiles p
        ON p.employee_id=e.id AND p.company_id=e.company_id
      JOIN omni_provider_outlet_accounts a
        ON a.id=p.provider_outlet_account_id AND a.company_id=p.company_id
      JOIN omni_provider_relationships r
        ON r.id=a.provider_relationship_id AND r.company_id=a.company_id
      JOIN omni_employee_outlet_assignments oa
        ON oa.employee_id=e.id AND oa.company_id=e.company_id AND oa.outlet_id=a.outlet_id
      JOIN omni_enterprise_outlets o
        ON o.id=a.outlet_id AND o.company_id=a.company_id
     WHERE e.staff_membership_id=NEW.staff_membership_id
       AND e.company_id=NEW.company_id
       AND e.employment_status='ACTIVE'
       AND a.id=NEW.scope_id
       AND a.status='ACTIVE'
       AND r.agreement_status='APPROVED'
       AND p.approval_status='APPROVED'
       AND oa.status='ACTIVE'
       AND datetime(oa.starts_at) <= datetime(NEW.starts_at)
       AND (oa.ends_at IS NULL OR datetime(oa.ends_at) > datetime(NEW.starts_at))
       AND o.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_PROVIDER_OPERATOR_APPROVAL_REQUIRED') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_staff_permission_grant_update_scope_guard
BEFORE UPDATE OF company_id,staff_membership_id,permission_key,scope_type,scope_id,granted_by,starts_at,expires_at
ON omni_staff_permission_grants
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships m
     WHERE m.id=NEW.staff_membership_id AND m.company_id=NEW.company_id AND m.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_GRANT_STAFF_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships actor
     WHERE actor.id=NEW.granted_by AND actor.company_id=NEW.company_id AND actor.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_GRANT_ACTOR_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.scope_type='COMPANY' AND NEW.scope_id IS NOT NULL
    THEN RAISE(ABORT, 'PERMISSION_COMPANY_SCOPE_ID_NOT_ALLOWED') END;
  SELECT CASE WHEN NEW.scope_type='SELF' AND NEW.scope_id <> NEW.staff_membership_id
    THEN RAISE(ABORT, 'PERMISSION_SELF_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.scope_type='OUTLET' AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    JOIN omni_employee_outlet_assignments a ON a.employee_id=e.id AND a.company_id=e.company_id
    JOIN omni_enterprise_outlets o ON o.id=a.outlet_id AND o.company_id=a.company_id
    WHERE e.staff_membership_id=NEW.staff_membership_id AND e.company_id=NEW.company_id
      AND e.employment_status='ACTIVE' AND a.outlet_id=NEW.scope_id AND a.status='ACTIVE'
      AND datetime(a.starts_at) <= datetime(NEW.starts_at)
      AND (a.ends_at IS NULL OR datetime(a.ends_at) > datetime(NEW.starts_at))
      AND o.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_OUTLET_ASSIGNMENT_REQUIRED') END;
  SELECT CASE WHEN NEW.scope_type='PROVIDER_ACCOUNT' AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    JOIN omni_provider_operator_profiles p ON p.employee_id=e.id AND p.company_id=e.company_id
    JOIN omni_provider_outlet_accounts a ON a.id=p.provider_outlet_account_id AND a.company_id=p.company_id
    JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id
    JOIN omni_employee_outlet_assignments oa ON oa.employee_id=e.id AND oa.company_id=e.company_id AND oa.outlet_id=a.outlet_id
    JOIN omni_enterprise_outlets o ON o.id=a.outlet_id AND o.company_id=a.company_id
    WHERE e.staff_membership_id=NEW.staff_membership_id AND e.company_id=NEW.company_id
      AND e.employment_status='ACTIVE' AND a.id=NEW.scope_id AND a.status='ACTIVE'
      AND r.agreement_status='APPROVED' AND p.approval_status='APPROVED'
      AND oa.status='ACTIVE' AND datetime(oa.starts_at) <= datetime(NEW.starts_at)
      AND (oa.ends_at IS NULL OR datetime(oa.ends_at) > datetime(NEW.starts_at))
      AND o.status='ACTIVE'
  ) THEN RAISE(ABORT, 'PERMISSION_PROVIDER_OPERATOR_APPROVAL_REQUIRED') END;
END;

-- Preserve access for existing active owner memberships. No other role is
-- automatically granted permissions.
INSERT OR IGNORE INTO omni_staff_permission_grants
  (id,company_id,staff_membership_id,permission_key,scope_type,scope_id,starts_at,expires_at,status,granted_by)
SELECT lower(hex(randomblob(16))), m.company_id, m.id, c.permission_key,
       'COMPANY', NULL, CURRENT_TIMESTAMP, NULL, 'ACTIVE', m.id
  FROM omni_staff_memberships m
 CROSS JOIN omni_permission_catalog c
 WHERE m.role='SOVEREIGN' AND m.status='ACTIVE';

-- KYC is a person/provider verification, not a SIM or agent-line assignment.
-- Keep only opaque secure-contact references, masked identifiers and evidence
-- references here. Never store raw national IDs, full personal phone numbers,
-- provider passwords, PINs or OTPs.
CREATE TABLE IF NOT EXISTS omni_employee_provider_kyc (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES omni_enterprise_employees(id) ON DELETE RESTRICT,
  provider_relationship_id TEXT NOT NULL REFERENCES omni_provider_relationships(id) ON DELETE RESTRICT,
  verification_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
    CHECK (verification_status IN ('NOT_SUBMITTED','PENDING','VERIFIED','REJECTED','EXPIRED','SUSPENDED')),
  provider_kyc_reference_masked TEXT,
  identity_document_reference_hash TEXT,
  identity_contact_reference TEXT,
  identity_contact_last4 TEXT CHECK (identity_contact_last4 IS NULL OR length(identity_contact_last4)=4),
  evidence_file_id TEXT REFERENCES omni_evidence_files(id) ON DELETE RESTRICT,
  verified_at TEXT,
  expires_at TEXT,
  last_verified_by TEXT REFERENCES omni_staff_memberships(id) ON DELETE RESTRICT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id,employee_id,provider_relationship_id),
  CHECK (verification_status <> 'VERIFIED' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_omni_employee_provider_kyc_status
  ON omni_employee_provider_kyc(company_id,provider_relationship_id,verification_status);

CREATE TRIGGER IF NOT EXISTS omni_employee_provider_kyc_scope_guard
BEFORE INSERT ON omni_employee_provider_kyc
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    JOIN omni_provider_relationships r ON r.company_id=e.company_id
    WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
      AND r.id=NEW.provider_relationship_id AND r.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'EMPLOYEE_PROVIDER_KYC_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.last_verified_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    WHERE s.id=NEW.last_verified_by AND s.company_id=NEW.company_id AND s.status='ACTIVE'
  ) THEN RAISE(ABORT, 'EMPLOYEE_PROVIDER_KYC_VERIFIER_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_employee_provider_kyc_update_scope_guard
BEFORE UPDATE OF company_id,employee_id,provider_relationship_id,last_verified_by
ON omni_employee_provider_kyc
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    JOIN omni_provider_relationships r ON r.company_id=e.company_id
    WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
      AND r.id=NEW.provider_relationship_id AND r.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'EMPLOYEE_PROVIDER_KYC_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.last_verified_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    WHERE s.id=NEW.last_verified_by AND s.company_id=NEW.company_id AND s.status='ACTIVE'
  ) THEN RAISE(ABORT, 'EMPLOYEE_PROVIDER_KYC_VERIFIER_SCOPE_MISMATCH') END;
END;

-- OtyaPoint provider operator access hardening.
-- Reuses the canonical enterprise tables created by migrations 0005 and 0006.
-- Does not create a second provider-account or employee-assignment model.
-- Approval is only recorded after an owner/admin attests to provider approval and training.
-- This migration does not enable provider transaction execution.

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operator_one_current_employee_account
  ON provider_operator_profiles(company_id, provider_outlet_account_id, employee_profile_id)
  WHERE provider_outlet_account_id IS NOT NULL
    AND approval_status IN ('PENDING','APPROVED','SUSPENDED');

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_provider_operation_grant_active
  ON employee_permission_grants(company_id, employee_profile_id, permission_key, scope_type, scope_id)
  WHERE permission_key = 'MOBILE_MONEY:OPERATE'
    AND scope_type = 'PROVIDER_ACCOUNT'
    AND status = 'ACTIVE';

CREATE TRIGGER IF NOT EXISTS provider_operator_active_insert_guard
BEFORE INSERT ON provider_operator_profiles
WHEN NEW.approval_status = 'APPROVED'
BEGIN
  SELECT CASE WHEN NEW.provider_operator_reference IS NULL OR length(trim(NEW.provider_operator_reference)) < 4
    THEN RAISE(ABORT, 'PROVIDER_OPERATOR_REFERENCE_REQUIRED') END;
  SELECT CASE WHEN NEW.training_status <> 'COMPLETED' OR NEW.training_completed_at IS NULL OR NEW.approved_at IS NULL
    THEN RAISE(ABORT, 'PROVIDER_OPERATOR_APPROVAL_REQUIRES_TRAINING_AND_APPROVAL') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM provider_relationships pr
      JOIN provider_outlet_accounts poa
        ON poa.company_id = pr.company_id
       AND poa.provider_relationship_id = pr.id
      JOIN employee_profiles ep ON ep.company_id = NEW.company_id AND ep.id = NEW.employee_profile_id
      JOIN staff_memberships sm ON sm.company_id = ep.company_id AND sm.id = ep.staff_membership_id
      JOIN employee_assignments ea
        ON ea.company_id = ep.company_id
       AND ea.employee_profile_id = ep.id
       AND ea.branch_id = poa.branch_id
      JOIN staff_work_assignments wa
        ON wa.company_id = sm.company_id
       AND wa.staff_membership_id = sm.id
       AND wa.branch_id = poa.branch_id
       AND wa.work_area = 'MOBILE_MONEY'
     WHERE pr.id = NEW.provider_relationship_id
       AND pr.company_id = NEW.company_id
       AND pr.onboarding_status = 'ACTIVE'
       AND (pr.expires_at IS NULL OR datetime(pr.expires_at) > CURRENT_TIMESTAMP)
       AND poa.id = NEW.provider_outlet_account_id
       AND poa.scope_type = 'OUTLET'
       AND poa.status = 'ACTIVE'
       AND ep.employment_status = 'ACTIVE'
       AND sm.status = 'ACTIVE'
       AND ea.status = 'ACTIVE'
       AND datetime(ea.starts_at) <= CURRENT_TIMESTAMP
       AND (ea.ends_at IS NULL OR datetime(ea.ends_at) > CURRENT_TIMESTAMP)
       AND wa.status = 'ACTIVE'
       AND wa.duty_role IN ('OPERATOR','SUPERVISOR','APPROVER')
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_REQUIRES_ACTIVE_BRANCH_MOBILE_MONEY_ASSIGNMENT') END;
  SELECT CASE WHEN NEW.sim_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM company_assets asset
      JOIN company_sim_details sim
        ON sim.company_id = asset.company_id AND sim.asset_id = asset.id
      JOIN asset_assignments assignment
        ON assignment.company_id = asset.company_id
       AND assignment.asset_id = asset.id
       AND assignment.employee_profile_id = NEW.employee_profile_id
      JOIN provider_relationships relationship
        ON relationship.company_id = NEW.company_id
       AND relationship.id = NEW.provider_relationship_id
     WHERE asset.company_id = NEW.company_id
       AND asset.id = NEW.sim_asset_id
       AND asset.asset_type = 'SIM_CARD'
       AND asset.lifecycle_status = 'ASSIGNED'
       AND sim.registration_status = 'COMPANY_REGISTERED'
       AND assignment.status = 'ISSUED'
       AND assignment.returned_at IS NULL
       AND assignment.branch_id = (
         SELECT branch_id FROM provider_outlet_accounts
          WHERE company_id = NEW.company_id AND id = NEW.provider_outlet_account_id
       )
       AND (
         (relationship.provider_code = 'AIRTEL_MONEY' AND sim.network_code = 'AIRTEL')
         OR (relationship.provider_code = 'MTN_MOMO' AND sim.network_code = 'MTN')
         OR relationship.provider_code = 'INTERSWITCH_QUICKTELLER'
       )
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_SIM_ASSIGNMENT_OR_NETWORK_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_operator_active_update_guard
BEFORE UPDATE OF approval_status, training_status, provider_relationship_id,
  provider_outlet_account_id, employee_profile_id, provider_operator_reference,
  sim_asset_id, approved_at, training_completed_at
ON provider_operator_profiles
WHEN NEW.approval_status = 'APPROVED'
BEGIN
  SELECT CASE WHEN NEW.provider_operator_reference IS NULL OR length(trim(NEW.provider_operator_reference)) < 4
    THEN RAISE(ABORT, 'PROVIDER_OPERATOR_REFERENCE_REQUIRED') END;
  SELECT CASE WHEN NEW.training_status <> 'COMPLETED' OR NEW.training_completed_at IS NULL OR NEW.approved_at IS NULL
    THEN RAISE(ABORT, 'PROVIDER_OPERATOR_APPROVAL_REQUIRES_TRAINING_AND_APPROVAL') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM provider_relationships pr
      JOIN provider_outlet_accounts poa
        ON poa.company_id = pr.company_id
       AND poa.provider_relationship_id = pr.id
      JOIN employee_profiles ep ON ep.company_id = NEW.company_id AND ep.id = NEW.employee_profile_id
      JOIN staff_memberships sm ON sm.company_id = ep.company_id AND sm.id = ep.staff_membership_id
      JOIN employee_assignments ea
        ON ea.company_id = ep.company_id
       AND ea.employee_profile_id = ep.id
       AND ea.branch_id = poa.branch_id
      JOIN staff_work_assignments wa
        ON wa.company_id = sm.company_id
       AND wa.staff_membership_id = sm.id
       AND wa.branch_id = poa.branch_id
       AND wa.work_area = 'MOBILE_MONEY'
     WHERE pr.id = NEW.provider_relationship_id
       AND pr.company_id = NEW.company_id
       AND pr.onboarding_status = 'ACTIVE'
       AND (pr.expires_at IS NULL OR datetime(pr.expires_at) > CURRENT_TIMESTAMP)
       AND poa.id = NEW.provider_outlet_account_id
       AND poa.scope_type = 'OUTLET'
       AND poa.status = 'ACTIVE'
       AND ep.employment_status = 'ACTIVE'
       AND sm.status = 'ACTIVE'
       AND ea.status = 'ACTIVE'
       AND datetime(ea.starts_at) <= CURRENT_TIMESTAMP
       AND (ea.ends_at IS NULL OR datetime(ea.ends_at) > CURRENT_TIMESTAMP)
       AND wa.status = 'ACTIVE'
       AND wa.duty_role IN ('OPERATOR','SUPERVISOR','APPROVER')
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_REQUIRES_ACTIVE_BRANCH_MOBILE_MONEY_ASSIGNMENT') END;
  SELECT CASE WHEN NEW.sim_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM company_assets asset
      JOIN company_sim_details sim
        ON sim.company_id = asset.company_id AND sim.asset_id = asset.id
      JOIN asset_assignments assignment
        ON assignment.company_id = asset.company_id
       AND assignment.asset_id = asset.id
       AND assignment.employee_profile_id = NEW.employee_profile_id
      JOIN provider_relationships relationship
        ON relationship.company_id = NEW.company_id
       AND relationship.id = NEW.provider_relationship_id
     WHERE asset.company_id = NEW.company_id
       AND asset.id = NEW.sim_asset_id
       AND asset.asset_type = 'SIM_CARD'
       AND asset.lifecycle_status = 'ASSIGNED'
       AND sim.registration_status = 'COMPANY_REGISTERED'
       AND assignment.status = 'ISSUED'
       AND assignment.returned_at IS NULL
       AND assignment.branch_id = (
         SELECT branch_id FROM provider_outlet_accounts
          WHERE company_id = NEW.company_id AND id = NEW.provider_outlet_account_id
       )
       AND (
         (relationship.provider_code = 'AIRTEL_MONEY' AND sim.network_code = 'AIRTEL')
         OR (relationship.provider_code = 'MTN_MOMO' AND sim.network_code = 'MTN')
         OR relationship.provider_code = 'INTERSWITCH_QUICKTELLER'
       )
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_SIM_ASSIGNMENT_OR_NETWORK_MISMATCH') END;
END;

-- Migration checksum covers the DDL above and excludes this ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0007_provider_operator_access', '9467f7e77922cf02fcd43c1fca3711953082cf57defb469eade2a48467ce79bd', CURRENT_TIMESTAMP);

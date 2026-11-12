-- Enterprise integrity and outlet stock enforcement.
-- Additive, source-only. Exercises company/outlet/provider identity boundaries
-- in the database as defence in depth; API authorization remains mandatory.

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_one_parent_per_product
  ON omni_provider_relationships(company_id, provider, provider_product)
  WHERE agreement_status <> 'TERMINATED';

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_external_account_reference
  ON omni_provider_outlet_accounts(provider_relationship_id, provider_account_reference)
  WHERE provider_account_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_outlet_external_id
  ON omni_provider_outlet_accounts(provider_relationship_id, provider_outlet_id)
  WHERE provider_outlet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_outlet_account_type
  ON omni_provider_outlet_accounts(provider_relationship_id, outlet_id, account_type)
  WHERE account_scope = 'OUTLET' AND status <> 'CLOSED';

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_provider_operator_account_employee
  ON omni_provider_operator_profiles(provider_outlet_account_id, employee_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_sim_one_active_assignment
  ON omni_sim_assignments(sim_card_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_device_one_active_assignment
  ON omni_device_assignments(device_id)
  WHERE status = 'ACTIVE';

CREATE TRIGGER IF NOT EXISTS omni_employee_outlet_assignment_guard
BEFORE INSERT ON omni_employee_outlet_assignments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    JOIN omni_enterprise_outlets o ON o.id=NEW.outlet_id AND o.company_id=e.company_id
    WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'EMPLOYEE_OUTLET_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_provider_outlet_account_guard
BEFORE INSERT ON omni_provider_outlet_accounts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_provider_relationships r
    JOIN omni_enterprise_outlets o ON o.id=NEW.outlet_id AND o.company_id=r.company_id
    WHERE r.id=NEW.provider_relationship_id
      AND r.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'PROVIDER_RELATIONSHIP_OUTLET_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_provider_operator_profile_guard
BEFORE INSERT ON omni_provider_operator_profiles
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM omni_provider_relationships r
    JOIN omni_provider_outlet_accounts a
      ON a.provider_relationship_id=r.id
     AND a.company_id=r.company_id
     AND a.id=NEW.provider_outlet_account_id
    JOIN omni_enterprise_employees e
      ON e.id=NEW.employee_id
     AND e.company_id=r.company_id
    JOIN omni_enterprise_outlets o
      ON o.id=a.outlet_id
     AND o.company_id=r.company_id
    WHERE r.id=NEW.provider_relationship_id
      AND r.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'PROVIDER_OPERATOR_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_sim_assignment_guard
BEFORE INSERT ON omni_sim_assignments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_company_sim_cards s
    JOIN omni_enterprise_outlets o ON o.id=NEW.outlet_id AND o.company_id=s.company_id
    WHERE s.id=NEW.sim_card_id AND s.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'SIM_OUTLET_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'SIM_EMPLOYEE_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.provider_outlet_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_provider_outlet_accounts a
    WHERE a.id=NEW.provider_outlet_account_id
      AND a.company_id=NEW.company_id
      AND a.outlet_id=NEW.outlet_id
  ) THEN RAISE(ABORT, 'SIM_PROVIDER_ACCOUNT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_device_assignment_guard
BEFORE INSERT ON omni_device_assignments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_company_devices d
    JOIN omni_enterprise_outlets o ON o.id=NEW.outlet_id AND o.company_id=d.company_id
    WHERE d.id=NEW.device_id AND d.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'DEVICE_OUTLET_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'DEVICE_EMPLOYEE_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_outlet_operating_account_guard
BEFORE INSERT ON omni_outlet_operating_accounts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_enterprise_outlets o
    WHERE o.id=NEW.outlet_id AND o.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'OPERATING_ACCOUNT_OUTLET_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.account_type='PROVIDER_FLOAT' AND NOT EXISTS (
    SELECT 1 FROM omni_provider_outlet_accounts a
    JOIN omni_provider_relationships r
      ON r.id=a.provider_relationship_id AND r.company_id=a.company_id
    WHERE a.id=NEW.provider_outlet_account_id
      AND a.company_id=NEW.company_id
      AND a.outlet_id=NEW.outlet_id
      AND r.provider=NEW.provider
  ) THEN RAISE(ABORT, 'OPERATING_ACCOUNT_PROVIDER_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    WHERE e.id=NEW.assigned_employee_id AND e.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'OPERATING_ACCOUNT_EMPLOYEE_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_evidence_ingestion_scope_guard
BEFORE INSERT ON omni_evidence_ingestion_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_provider_outlet_accounts a
    JOIN omni_provider_relationships r
      ON r.id=a.provider_relationship_id AND r.company_id=a.company_id
    JOIN omni_enterprise_outlets o
      ON o.id=a.outlet_id AND o.company_id=a.company_id
    JOIN omni_staff_memberships s
      ON s.id=NEW.submitted_by AND s.company_id=a.company_id
    WHERE a.id=NEW.provider_outlet_account_id
      AND a.company_id=NEW.company_id
      AND a.outlet_id=NEW.outlet_id
      AND r.provider=NEW.provider
  ) THEN RAISE(ABORT, 'EVIDENCE_PROVIDER_OUTLET_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.evidence_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_evidence_files f
    WHERE f.id=NEW.evidence_file_id
      AND f.company_id=NEW.company_id
      AND (f.outlet_id IS NULL OR f.outlet_id=NEW.outlet_id)
  ) THEN RAISE(ABORT, 'EVIDENCE_FILE_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_provider_transaction_scope_guard
BEFORE INSERT ON omni_provider_transaction_records
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_provider_relationships r
    JOIN omni_provider_outlet_accounts a
      ON a.provider_relationship_id=r.id
     AND a.company_id=r.company_id
     AND a.id=NEW.provider_outlet_account_id
    JOIN omni_enterprise_outlets o
      ON o.id=a.outlet_id
     AND o.company_id=a.company_id
    WHERE r.id=NEW.provider_relationship_id
      AND r.company_id=NEW.company_id
      AND a.company_id=NEW.company_id
      AND a.outlet_id=NEW.outlet_id
      AND r.provider=NEW.provider
      AND a.status='ACTIVE'
      AND r.agreement_status='APPROVED'
  ) THEN RAISE(ABORT, 'PROVIDER_TRANSACTION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_employees e
    WHERE e.id=NEW.employee_id
      AND e.company_id=NEW.company_id
      AND e.employment_status='ACTIVE'
  ) THEN RAISE(ABORT, 'PROVIDER_TRANSACTION_EMPLOYEE_MISMATCH') END;
  SELECT CASE WHEN NEW.evidence_ingestion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM omni_evidence_ingestion_items i
    WHERE i.id=NEW.evidence_ingestion_id
      AND i.company_id=NEW.company_id
      AND i.provider=NEW.provider
      AND i.outlet_id=NEW.outlet_id
      AND i.provider_outlet_account_id=NEW.provider_outlet_account_id
      AND i.parse_status='NEEDS_REVIEW'
  ) THEN RAISE(ABORT, 'PROVIDER_TRANSACTION_EVIDENCE_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_provider_balance_observation_scope_guard
BEFORE INSERT ON omni_provider_balance_observations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_provider_outlet_accounts a
    JOIN omni_provider_relationships r
      ON r.id=a.provider_relationship_id AND r.company_id=a.company_id
    WHERE a.id=NEW.provider_outlet_account_id
      AND a.company_id=NEW.company_id
      AND a.outlet_id=NEW.outlet_id
      AND r.provider=NEW.provider
  ) THEN RAISE(ABORT, 'PROVIDER_BALANCE_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    WHERE s.id=NEW.recorded_by AND s.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'PROVIDER_BALANCE_ACTOR_COMPANY_MISMATCH') END;
  SELECT CASE WHEN NEW.verification_level='READ_ONLY_PROVIDER_CONFIRMED'
    AND NEW.source_type<>'READ_ONLY_PROVIDER_FEED'
    THEN RAISE(ABORT, 'PROVIDER_BALANCE_CONFIRMATION_SOURCE_REQUIRED') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_outlet_stock_movement_scope_guard
BEFORE INSERT ON omni_outlet_stock_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_outlet_stock_balances b
    WHERE b.company_id=NEW.company_id
      AND b.outlet_id=NEW.outlet_id
      AND b.product_id=NEW.product_id
  ) AND NOT EXISTS (
    SELECT 1 FROM omni_enterprise_outlets o
    JOIN omni_products p ON p.company_id=NEW.company_id
    WHERE o.id=NEW.outlet_id AND o.company_id=NEW.company_id
      AND p.id=NEW.product_id AND p.is_active=1
  ) THEN RAISE(ABORT, 'OUTLET_STOCK_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.quantity_after<>(
    SELECT COALESCE((
      SELECT b.quantity_on_hand FROM omni_outlet_stock_balances b
      WHERE b.company_id=NEW.company_id
        AND b.outlet_id=NEW.outlet_id
        AND b.product_id=NEW.product_id
    ),0)+NEW.quantity_delta
  ) THEN RAISE(ABORT, 'OUTLET_STOCK_MOVEMENT_MISMATCH') END;
  SELECT CASE WHEN NEW.quantity_after<0
    THEN RAISE(ABORT, 'OUTLET_STOCK_NEGATIVE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM omni_staff_memberships s
    WHERE s.id=NEW.actor_id AND s.company_id=NEW.company_id
  ) THEN RAISE(ABORT, 'OUTLET_STOCK_ACTOR_COMPANY_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS omni_outlet_stock_movement_apply
AFTER INSERT ON omni_outlet_stock_movements
BEGIN
  INSERT INTO omni_outlet_stock_balances
    (id,company_id,outlet_id,product_id,quantity_on_hand,quantity_reserved,reorder_level,updated_at)
  VALUES
    (lower(hex(randomblob(16))),NEW.company_id,NEW.outlet_id,NEW.product_id,
     NEW.quantity_after,0,0,CURRENT_TIMESTAMP)
  ON CONFLICT(company_id,outlet_id,product_id)
  DO UPDATE SET quantity_on_hand=excluded.quantity_on_hand,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS omni_provider_balance_observations_no_update
BEFORE UPDATE ON omni_provider_balance_observations
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_BALANCE_OBSERVATIONS_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS omni_provider_balance_observations_no_delete
BEFORE DELETE ON omni_provider_balance_observations
BEGIN
  SELECT RAISE(ABORT, 'PROVIDER_BALANCE_OBSERVATIONS_APPEND_ONLY');
END;

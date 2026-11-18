-- Separate provider float ledgers from operator cash drawers and guard Mobile Money postings.
ALTER TABLE agency_operations
  ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id) ON DELETE RESTRICT;
ALTER TABLE agency_operations
  ADD COLUMN provider_outlet_account_id TEXT REFERENCES provider_outlet_accounts(id) ON DELETE RESTRICT;

CREATE TRIGGER IF NOT EXISTS cash_provider_float_insert_guard
BEFORE INSERT ON cash_accounts
WHEN NEW.account_type = 'PROVIDER_FLOAT'
BEGIN
  SELECT CASE WHEN NEW.work_area <> 'MOBILE_MONEY'
    OR NEW.provider_code NOT IN ('AIRTEL_MONEY','MTN_MOMO')
    THEN RAISE(ABORT, 'PROVIDER_FLOAT_REQUIRES_MATCHED_MOBILE_MONEY_PROVIDER') END;
END;

CREATE TRIGGER IF NOT EXISTS cash_provider_float_update_guard
BEFORE UPDATE OF account_type,work_area,provider_code ON cash_accounts
WHEN NEW.account_type = 'PROVIDER_FLOAT'
BEGIN
  SELECT CASE WHEN NEW.work_area <> 'MOBILE_MONEY'
    OR NEW.provider_code NOT IN ('AIRTEL_MONEY','MTN_MOMO')
    THEN RAISE(ABORT, 'PROVIDER_FLOAT_REQUIRES_MATCHED_MOBILE_MONEY_PROVIDER') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_outlet_float_account_guard
BEFORE INSERT ON provider_outlet_accounts
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM cash_accounts ca
      JOIN provider_relationships pr
        ON pr.company_id = ca.company_id
       AND pr.id = NEW.provider_relationship_id
     WHERE ca.company_id = NEW.company_id
       AND ca.id = NEW.cash_account_id
       AND ca.branch_id = NEW.branch_id
       AND ca.account_type = 'PROVIDER_FLOAT'
       AND ca.work_area = 'MOBILE_MONEY'
       AND ca.provider_code = pr.provider_code
       AND pr.provider_code IN ('AIRTEL_MONEY','MTN_MOMO')
  ) THEN RAISE(ABORT, 'PROVIDER_OUTLET_REQUIRES_MATCHED_FLOAT_ACCOUNT') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_outlet_float_account_update_guard
BEFORE UPDATE OF cash_account_id,branch_id,provider_relationship_id ON provider_outlet_accounts
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM cash_accounts ca
      JOIN provider_relationships pr
        ON pr.company_id = ca.company_id
       AND pr.id = NEW.provider_relationship_id
     WHERE ca.company_id = NEW.company_id
       AND ca.id = NEW.cash_account_id
       AND ca.branch_id = NEW.branch_id
       AND ca.account_type = 'PROVIDER_FLOAT'
       AND ca.work_area = 'MOBILE_MONEY'
       AND ca.provider_code = pr.provider_code
       AND pr.provider_code IN ('AIRTEL_MONEY','MTN_MOMO')
  ) THEN RAISE(ABORT, 'PROVIDER_OUTLET_REQUIRES_MATCHED_FLOAT_ACCOUNT') END;
END;

CREATE TRIGGER IF NOT EXISTS agency_operation_manual_operator_guard
BEFORE INSERT ON agency_operations
BEGIN
  SELECT CASE WHEN NEW.recording_mode <> 'MANUAL_UNVERIFIED' OR NEW.status <> 'UNKNOWN'
    THEN RAISE(ABORT, 'AGENCY_OPERATION_REQUIRES_UNVERIFIED_MANUAL_RECORDING') END;
  SELECT CASE WHEN NEW.cash_session_id IS NULL OR NEW.provider_outlet_account_id IS NULL
    THEN RAISE(ABORT, 'AGENCY_OPERATION_REQUIRES_CASH_SESSION_AND_PROVIDER_OUTLET') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM cash_sessions cs
      JOIN cash_accounts drawer
        ON drawer.company_id = cs.company_id
       AND drawer.id = cs.cash_account_id
      JOIN provider_outlet_accounts poa
        ON poa.company_id = NEW.company_id
       AND poa.id = NEW.provider_outlet_account_id
      JOIN provider_relationships pr
        ON pr.company_id = poa.company_id
       AND pr.id = poa.provider_relationship_id
      JOIN cash_accounts float_account
        ON float_account.company_id = poa.company_id
       AND float_account.id = poa.cash_account_id
       AND float_account.ledger_account_id IS NOT NULL
      JOIN provider_operator_profiles op
        ON op.company_id = NEW.company_id
       AND op.provider_outlet_account_id = poa.id
      JOIN employee_profiles ep
        ON ep.company_id = op.company_id
       AND ep.id = op.employee_profile_id
      JOIN staff_memberships sm
        ON sm.company_id = ep.company_id
       AND sm.id = ep.staff_membership_id
      JOIN employee_assignments ea
        ON ea.company_id = ep.company_id
       AND ea.employee_profile_id = ep.id
       AND ea.branch_id = poa.branch_id
      JOIN staff_work_assignments wa
        ON wa.company_id = sm.company_id
       AND wa.staff_membership_id = sm.id
       AND wa.branch_id = poa.branch_id
       AND wa.work_area = 'MOBILE_MONEY'
      JOIN employee_permission_grants pg
        ON pg.company_id = op.company_id
       AND pg.employee_profile_id = ep.id
       AND pg.permission_key = 'MOBILE_MONEY:OPERATE'
       AND pg.scope_type = 'PROVIDER_ACCOUNT'
       AND pg.scope_id = poa.id
     WHERE cs.company_id = NEW.company_id
       AND cs.id = NEW.cash_session_id
       AND cs.branch_id = NEW.branch_id
       AND cs.opened_by = NEW.actor_id
       AND cs.status = 'OPEN'
       AND drawer.account_type = 'CASH_DRAWER'
       AND drawer.work_area = 'MOBILE_MONEY'
       AND drawer.status = 'ACTIVE'
       AND poa.branch_id = NEW.branch_id
       AND poa.scope_type = 'OUTLET'
       AND poa.status = 'ACTIVE'
       AND poa.cash_account_id = float_account.id
       AND float_account.account_type = 'PROVIDER_FLOAT'
       AND float_account.work_area = 'MOBILE_MONEY'
       AND float_account.provider_code = pr.provider_code
       AND float_account.status = 'ACTIVE'
       AND pr.provider_code = NEW.provider_code
       AND pr.onboarding_status = 'ACTIVE'
       AND (pr.expires_at IS NULL OR datetime(pr.expires_at) > CURRENT_TIMESTAMP)
       AND ep.employment_status = 'ACTIVE'
       AND sm.identity_subject = NEW.actor_id
       AND sm.status = 'ACTIVE'
       AND ea.status = 'ACTIVE'
       AND datetime(ea.starts_at) <= CURRENT_TIMESTAMP
       AND (ea.ends_at IS NULL OR datetime(ea.ends_at) > CURRENT_TIMESTAMP)
       AND wa.status = 'ACTIVE'
       AND wa.duty_role IN ('OPERATOR','SUPERVISOR','APPROVER')
       AND op.approval_status = 'APPROVED'
       AND op.training_status = 'COMPLETED'
       AND (op.valid_until IS NULL OR datetime(op.valid_until) > CURRENT_TIMESTAMP)
       AND pg.status = 'ACTIVE'
       AND datetime(pg.starts_at) <= CURRENT_TIMESTAMP
       AND (pg.expires_at IS NULL OR datetime(pg.expires_at) > CURRENT_TIMESTAMP)
       AND (op.sim_asset_id IS NULL OR EXISTS (
         SELECT 1
           FROM company_assets asset
           JOIN company_sim_details sim
             ON sim.company_id = asset.company_id AND sim.asset_id = asset.id
           JOIN asset_assignments aa
             ON aa.company_id = asset.company_id AND aa.asset_id = asset.id
          WHERE asset.company_id = op.company_id
            AND asset.id = op.sim_asset_id
            AND asset.asset_type = 'SIM_CARD'
            AND asset.lifecycle_status = 'ASSIGNED'
            AND sim.registration_status = 'COMPANY_REGISTERED'
            AND aa.employee_profile_id = op.employee_profile_id
            AND aa.branch_id = poa.branch_id
            AND aa.status = 'ISSUED'
            AND aa.returned_at IS NULL
            AND ((pr.provider_code = 'AIRTEL_MONEY' AND sim.network_code = 'AIRTEL')
              OR (pr.provider_code = 'MTN_MOMO' AND sim.network_code = 'MTN'))
       ))
  ) THEN RAISE(ABORT, 'AGENCY_OPERATION_REQUIRES_ACTIVE_APPROVED_OPERATOR') END;
  SELECT CASE WHEN NEW.operation_type = 'CASH_OUT'
    AND COALESCE((
      SELECT expected_closing_amount
        FROM cash_sessions
       WHERE company_id = NEW.company_id AND id = NEW.cash_session_id AND status = 'OPEN'
    ), 0) < NEW.amount
    THEN RAISE(ABORT, 'AGENCY_CASH_OUT_EXCEEDS_CASH_SESSION_BALANCE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM payment_intents pi
     WHERE pi.company_id = NEW.company_id
       AND pi.id = NEW.payment_intent_id
       AND pi.source_type = 'AGENCY_OPERATION'
       AND pi.source_id = NEW.id
       AND pi.operation_type = NEW.operation_type
       AND pi.provider_code = NEW.provider_code
       AND pi.status = 'UNKNOWN'
       AND pi.amount = NEW.amount
  ) THEN RAISE(ABORT, 'AGENCY_OPERATION_PAYMENT_INTENT_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS agency_operation_cash_session_balance
AFTER INSERT ON agency_operations
BEGIN
  UPDATE cash_sessions
     SET expected_closing_amount = COALESCE(expected_closing_amount, opening_amount)
       + CASE WHEN NEW.operation_type = 'CASH_IN' THEN NEW.amount ELSE -NEW.amount END
   WHERE company_id = NEW.company_id
     AND id = NEW.cash_session_id
     AND status = 'OPEN';
END;

-- Check every provider float asset at the moment a journal entry is posted.
-- D1 serializes writes; this prevents concurrent deposits from overspending float.
CREATE TRIGGER IF NOT EXISTS cash_drawer_nonnegative_balance_guard
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM journal_lines current_line
      JOIN cash_accounts drawer_account
        ON drawer_account.company_id = current_line.company_id
       AND drawer_account.ledger_account_id = current_line.ledger_account_id
       AND drawer_account.account_type = 'CASH_DRAWER'
     WHERE current_line.company_id = NEW.company_id
       AND current_line.journal_entry_id = NEW.id
       AND (
         COALESCE((
           SELECT SUM(posted_line.debit_amount - posted_line.credit_amount)
             FROM journal_lines posted_line
             JOIN journal_entries posted_entry
               ON posted_entry.company_id = posted_line.company_id
              AND posted_entry.id = posted_line.journal_entry_id
            WHERE posted_line.company_id = NEW.company_id
              AND posted_line.ledger_account_id = current_line.ledger_account_id
              AND posted_entry.status = 'POSTED'
         ), 0)
         + COALESCE((
           SELECT SUM(new_line.debit_amount - new_line.credit_amount)
             FROM journal_lines new_line
            WHERE new_line.company_id = NEW.company_id
              AND new_line.journal_entry_id = NEW.id
              AND new_line.ledger_account_id = current_line.ledger_account_id
         ), 0)
       ) < 0
  ) THEN RAISE(ABORT, 'CASH_DRAWER_BALANCE_WOULD_BE_NEGATIVE') END;
END;

CREATE TRIGGER IF NOT EXISTS provider_float_nonnegative_balance_guard
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM journal_lines current_line
      JOIN cash_accounts float_account
        ON float_account.company_id = current_line.company_id
       AND float_account.ledger_account_id = current_line.ledger_account_id
       AND float_account.account_type = 'PROVIDER_FLOAT'
     WHERE current_line.company_id = NEW.company_id
       AND current_line.journal_entry_id = NEW.id
       AND (
         COALESCE((
           SELECT SUM(posted_line.debit_amount - posted_line.credit_amount)
             FROM journal_lines posted_line
             JOIN journal_entries posted_entry
               ON posted_entry.company_id = posted_line.company_id
              AND posted_entry.id = posted_line.journal_entry_id
            WHERE posted_line.company_id = NEW.company_id
              AND posted_line.ledger_account_id = current_line.ledger_account_id
              AND posted_entry.status = 'POSTED'
         ), 0)
         + COALESCE((
           SELECT SUM(new_line.debit_amount - new_line.credit_amount)
             FROM journal_lines new_line
            WHERE new_line.company_id = NEW.company_id
              AND new_line.journal_entry_id = NEW.id
              AND new_line.ledger_account_id = current_line.ledger_account_id
         ), 0)
       ) < 0
  ) THEN RAISE(ABORT, 'PROVIDER_FLOAT_BALANCE_WOULD_BE_NEGATIVE') END;
END;

-- Checksum covers the migration body above and excludes the ledger insert.
INSERT INTO opoint_schema_migrations (version, checksum_sha256, applied_at)
VALUES ('0010_provider_float_integrity', 'bdeacbdff987842c06750d420896181e1a0e0ee2d1b33f7d50990ddc86e37857', CURRENT_TIMESTAMP);

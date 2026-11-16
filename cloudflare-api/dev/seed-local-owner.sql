-- Synthetic local-only staff identity for the Wrangler multi-Worker test rig.
-- This inserts no customer, product, stock, sale, payment or ledger records.
-- Create the synthetic local branch before assigning the synthetic staff membership.
INSERT INTO omni_branches (
  id, company_id, branch_code, name, town_council, status, is_primary
) VALUES (
  'local-branch', 'local-company', 'LOCAL', 'Local test branch', 'Local development', 'ACTIVE', 1
) ON CONFLICT(id) DO UPDATE SET
  company_id = excluded.company_id,
  branch_code = excluded.branch_code,
  name = excluded.name,
  town_council = excluded.town_council,
  status = excluded.status,
  is_primary = excluded.is_primary;
INSERT INTO omni_staff_memberships (
  id,
  identity_subject,
  company_id,
  branch_id,
  role,
  status,
  created_by,
  display_name,
  email,
  agent_id
)
VALUES (
  'local-staff-owner',
  'synthetic-otyapoint-local-owner',
  'local-company',
  'local-branch',
  'SOVEREIGN',
  'ACTIVE',
  'local-development-seed',
  'Local Synthetic Owner',
  'owner@local.invalid',
  'LOCAL001'
)
ON CONFLICT(identity_subject) DO UPDATE SET
  company_id = excluded.company_id,
  branch_id = excluded.branch_id,
  role = excluded.role,
  status = excluded.status,
  display_name = excluded.display_name,
  email = excluded.email,
  agent_id = excluded.agent_id;

# Opoint D1 schema snapshot

This snapshot is exported from the isolated Opoint staging database on 2026-11-11.

- Application-controlled tables including migration ledger: 44
- Views: 1
- Explicit indexes: 19
- Triggers: 9 (the original 2026-11-11 snapshot; forward migrations add further guards)
- Migration history embedded in the bootstrap: 0001_opoint_core (22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224); 0002_operational_hardening (1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a); 0003_financial_integrity_guards (10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868). Forward migrations 0004–0008 are applied separately and are not embedded in the baseline.

The SQL contains DDL and migration-history rows only. It excludes Cloudflare's internal _cf_KV table and contains no application records or secrets.

**Use:** This is a one-time bootstrap for a brand-new empty Opoint database. Do not apply it to the existing staging database. Existing environments must be changed only through new forward-only migration files. Review any bootstrap target and take a backup before execution.


## Forward-only work-area migration

The `0004_staff_work_assignments.sql` migration adds independent Retail and Mobile Money assignments scoped to a company, staff membership and branch. A worker may hold both assignments at one branch with different duty roles. Cash accounts gain an explicit `work_area`; existing provider-float/provider-coded accounts are classified as Mobile Money, while existing cash drawers default to Retail until an owner deliberately changes them through a reviewed workflow.

The migration is applied only through the isolated staging deployment workflow after Otya ID staging is verified. Never run it against production as part of this rebuild. It adds no staff assignments and does not move, create or adjust cash/float balances.

## Enterprise schema additions (forward-only; review branch)

Migrations `0005_enterprise_automation.sql` and `0006_message_capture_and_receipts.sql` extend the OtyaPoint-owned schema after `0004_staff_work_assignments.sql`. They do not change historical migrations or the schema-only bootstrap snapshot.

The additions model workforce profiles, private company assets/SIM inventory, provider relationships and outlet accounts, provider balance observations, explicit message/statement evidence and immutable issued receipts. They are not yet exposed as complete production APIs or user interfaces. Apply them only through the manual isolated staging workflow after the Otya ID staging dependency is healthy. No automatic SMS inbox access, payment initiation or provider credential storage is introduced.

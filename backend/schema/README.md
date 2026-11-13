# Opoint D1 schema snapshot

This snapshot is exported from the isolated Opoint staging database on 2026-11-11.

- Product D1 ID: ec080a51-cfc9-4375-8b3c-64667744b466
- Application-controlled tables including migration ledger: 44
- Views: 1
- Explicit indexes: 19
- Triggers: 9
- Migration history: 0001_opoint_core (22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224); 0002_operational_hardening (1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a); 0003_financial_integrity_guards (10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868)

The SQL contains DDL and migration-history rows only. It excludes Cloudflare's internal _cf_KV table and contains no application records or secrets.

**Use:** This is a one-time bootstrap for a brand-new empty Opoint database. Do not apply it to the existing staging database. Existing environments must be changed only through new forward-only migration files. Review any bootstrap target and take a backup before execution.

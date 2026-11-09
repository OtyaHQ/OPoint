# OtyaPoint build and operational status

Last verified: 2026-11-09.

## Architecture decision

- Cloudflare is the target runtime and data platform.
- GitHub is the canonical source repository and CI platform.
- D1 is the business data store; R2 stores private files and recovery snapshots.
- KV is only for reconstructable cache, never financial source-of-truth records.
- Queues are for asynchronous work after retry/idempotency/dead-letter behavior is tested.
- Otya Auth provides shared identity; OtyaPoint retains local staff membership and role authorization.
- Resend remains the shared transactional email provider.
- Do not add Supabase, Appwrite, or Vercel to the target runtime unless explicitly approved.

## Verified Cloudflare resources

- D1 `otyapoint-db`, UUID `65cc4aee-154a-474f-9ed4-aabea0924c98`, EU jurisdiction.
- D1 `omnipoint-dev`, UUID `2c4de5d4-6898-4768-9a60-091bca7779b5`, EU jurisdiction. Preserve until its role is formally retired.
- D1 `otya-auth-db` and `otya-store-db` are shared ecosystem resources; do not repurpose or delete them.
- R2 `otyapoint-private` and `otyapoint-backups` are dedicated OtyaPoint buckets.
- The backup bucket contains verified point-in-time SQL snapshots for both OtyaPoint databases. PR #120 added a daily R2 backup workflow with SHA-256 read-back verification, but its first run requires the dedicated GitHub Actions Cloudflare API token and account-ID repository variable; see `docs/D1_BACKUP_AUTOMATION.md`.
- The snapshots were restored into isolated EU D1 verification databases: `otyapoint-restore-verify-20261030` and `omnipoint-restore-verify-20261030`.
- KV `otyapoint-dev-cache` retains namespace ID `69ca8a463e60410d907749d4e863faf4`.
- Queues `otyapoint-dev-jobs` and `otyapoint-dev-jobs-dlq` exist; no consumer should be attached until retry and DLQ behavior are tested.
- Existing Otya Workers `otya-auth`, `otya-core`, and `otya-next` remain separate and active.

## D1 state and differences

Production `otyapoint-db` now has 13 OtyaPoint business tables and the required sale-idempotency, owner/staff invitation, append-only history, and agency cash/float integrity objects. All 13 business tables currently contain zero rows. Its migration ledger was verified through `0009_agency_cash_float_book.sql` on 2026-11-09. `omnipoint-dev` remains a separate legacy database with its earlier schema and migration history. The two migration-history table definitions differ:
- `otyapoint-db`: `d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, applied_at ...)`
- `omnipoint-dev`: `d1_migrations(name TEXT PRIMARY KEY, applied_at ...)`

Do not delete either database or treat their migration histories as interchangeable until a reviewed canonicalization plan is approved.

## Authentication regression and migration status (2026-10-30)

- PR #82 merged Otya Auth identity/staff-authorization regression tests; this verifies the Worker boundary with synthetic identities and mocked services, not deployed authentication or dashboard integration.
- The existing dashboard login still uses Supabase Auth. PR #85 removed the local HS256 bridge-token flow and made the products bridge fail closed with HTTP 503 until the Otya Auth session contract is implemented.
- `docs/OTYA_AUTH_CLOUDFLARE_MIGRATION_RUNBOOK.md` defines the staged migration and explicit release gates. The login/session migration, staff provisioning path, dashboard data migration, and preview deployment remain incomplete.

## Deployment and application state

- Root `wrangler.toml` targets `otyapoint-api` and `otyapoint-db`.
- `workers_dev=false`; no custom route is configured. The latest live Cloudflare inventory still lists only `otya-auth`, `otya-core`, and `otya-next`; the `otyapoint-api` Worker is not deployed. Production D1 is schema-ready through `0009`, but the application service is not yet reachable.
- The existing Next.js dashboard still imports Supabase Auth and Prisma and is not yet fully connected to the Cloudflare API.
- The products bridge is now deliberately disabled with a non-cacheable 503 and regression coverage until dashboard login/session uses Otya Auth and the verified identity maps to an active D1 staff membership.
- Agency-provider transaction execution remains disabled. No live payments or public route were enabled.

## CI and release gates

The documentation-only Cloudflare-first PR #77 was merged after Security Baseline and Verify OmniPoint both passed. Those checks validate repository workflows, not end-to-end deployment readiness.

Before private preview:
1. Define and contract-test service-to-service authentication and staff provisioning.
2. Migrate dashboard data/auth flows behind a server-side API boundary.
3. Validate sale atomicity, idempotency, concurrency, stock/ledger invariants, and rollback.
4. Configure scheduled backups, retention, failure alerts, and restore drills.
5. Confirm bindings and access controls; verify redaction and alert routing.
6. Deploy a restricted preview only after build, security, and integration tests pass.

Passing CI, a successful restore, or a health endpoint is not proof of payment-provider or production readiness.

# OtyaPoint Cloudflare API

OtyaPoint is the shop and financial-agency operations system of Otya Hold Ltd T/A OtyaPoint. The intended runtime is Cloudflare Workers + D1 + R2 + KV + Queues, with GitHub for source control and Resend for shared transactional email where required.

## Current verified state

- Wrangler config names the API Worker `otyapoint-api`, binds D1 `DB` to `otyapoint-db`, R2 `PRIVATE_FILES` and `BACKUPS`, KV `CACHE`, queue producer `JOBS`, and the Otya Auth service binding.
- `workers_dev = false`; no custom route is configured. **The API Worker is not confirmed deployed.**
- The three checked-in migrations are `0001_core.sql`, `0002_company_scope.sql`, and `0003_staff_profile.sql`.
- The core schema has nine business tables and four stock/sale triggers. The nine core business tables currently contain zero rows; `d1_migrations` contains three migration records.
- The legacy `omnipoint-dev` D1 database also has zero rows in those nine business tables. Its core schema matches the new database, but the `d1_migrations` table definition differs: legacy uses `name` as its primary key; the new database has an integer `id` plus `name`. This is a migration-history difference, not proof that the databases are interchangeable.

## Backup and restore evidence (2026-10-30)

SQL recovery snapshots were generated through read-only D1 schema/data queries, uploaded to private R2 bucket `otyapoint-backups`, read back, and restored into isolated EU D1 verification databases. Both restores reproduced 35 schema objects, all three migration records, and the observed core business row counts.

| Source database | R2 object key | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `otyapoint-db` | `d1/otyapoint-db/2026-10-30-recovery.sql` | 11241 | `21051eee120339be5eec44255a2944e596b34af299590cd9cf62f85b51bd564a` |
| `omnipoint-dev` | `d1/omnipoint-dev/2026-10-30-recovery.sql` | 11175 | `b44fc62409ba6381229c3d3dfa227b0084545649bc79f07c7053a73a34bae93e` |

Verification databases:
- `otyapoint-restore-verify-20261030`
- `omnipoint-restore-verify-20261030`

These are point-in-time recovery snapshots, not an automated backup schedule. Keep the snapshots and restore databases until a separate retention/cleanup review. Do not delete either source D1 database based on matching empty business-table counts alone.

## Local development

```sh
npx wrangler dev --config wrangler.toml
python3 cloudflare-api/tests/test_core_schema.py
python3 migration/d1/test_schema.py
npm run check:worker
```

Local SQLite tests validate schema invariants; they do not prove Cloudflare D1 concurrency, deployed authentication behavior, or production readiness.

Migration `0004_sale_request_fingerprint.sql` adds a nullable fingerprint to bind a retail-sale idempotency key to its canonical payment method and normalized product/quantity list. Legacy rows remain unverified because their original request payload was not stored; retries for those rows intentionally return HTTP 409 rather than falsely claiming an exact replay. Apply only to the isolated development database after reviewing the target. Do not apply remotely or to production as part of this change.

Migration `0004_sale_request_fingerprint.sql` adds a nullable fingerprint to bind a retail-sale idempotency key to its canonical payment method and normalized product/quantity list. Legacy rows remain unverified because their original request payload was not stored; retries for those rows intentionally return HTTP 409 rather than falsely claiming an exact replay. Apply only to the isolated development database after reviewing the target. Do not apply remotely or to production as part of this change.

## API surface

- `GET /health`: schema readiness only.
- `GET /api/me`: verified Otya identity mapped to active local staff membership.
- `GET /api/products`: authenticated inventory read.
- `POST /api/products`: manager-authorized product creation with audit record.
- `POST /api/stock-adjustments`: manager-authorized audited stock movement.
- `POST /api/sales`: cash-only retail sale with idempotency and ledger/audit records.
- `GET /api/summary` and `GET /api/ledger`: manager-authorized views.
- `POST /api/agency-transactions`: disabled; no provider call is made and no transaction is represented as successful.

## Identity and dashboard integration

Otya Auth is the intended identity provider. OtyaPoint separately authorizes local staff memberships and roles; a global Otya login alone must never grant shop access.

The current Next.js dashboard still imports Supabase Auth and Prisma. Its existing `/api/bridge/products` route constructs a local HS256 token, then sends it to Otya Auth's `/auth/verify` endpoint. The token contract has not been verified to accept this locally minted token, so the bridge must be treated as **unverified and not production-ready**. Do not configure secrets or enable the bridge until a documented Otya Auth-to-OtyaPoint service-token contract and integration tests are in place.

Migrate the dashboard behind a server-side API boundary in reviewed steps. Do not remove legacy packages or migrations until all runtime imports, login/session flows, staff provisioning, and UI data paths are migrated and tested. Do not add Supabase, Appwrite, or Vercel to the new runtime unless explicitly approved.

## Money movement and production

Agency-provider transactions remain disabled. No public endpoint, custom domain, live payment-provider operation, or production cutover is enabled by this configuration. Before activation, verify signed provider callbacks, replay protection, idempotency, timeout/retry/reversal handling, reconciliation, balanced ledger invariants, backup schedule/restore drills, alert delivery, and applicable Uganda compliance requirements.


## Isolated local multi-Worker development (2026-11-09)

The safe local runtime is defined by the root `wrangler.local.toml` and `wrangler.auth-local.toml` files. Start it with:

```sh
npm run dev:local:check
npm run test:local-auth
npm run dev:local
```

The first config starts the OtyaPoint API with local-only D1/R2/KV/Queue simulations. The second config starts a synthetic Auth verifier and is attached through a local service binding. The synthetic verifier accepts only `Bearer otya-local-test-token` and returns the test identity `synthetic-otyapoint-local-owner`. It is not Otya Auth and must never be deployed or used for production authentication.

The local bootstrap applies the checked-in migrations to Wrangler's local D1 state and upserts one synthetic `SOVEREIGN` staff membership. It inserts no business, customer, inventory, sale, cash, float, ledger or payment rows. No provider credentials or live provider adapters are configured.

Run the full local smoke test using `npm run test:local-runtime`. It verifies schema readiness, the synthetic Auth-to-staff mapping, and that `POST /api/agency-transactions` returns HTTP 501 without calling a provider. Wrangler commands are pinned to version 4.158.0 for repeatable tooling.

Never run these commands with `--remote`, never add `remote = true` to a binding, and never deploy either local Wrangler config. The regular `wrangler.toml` and live Otya Auth service remain separate release concerns.

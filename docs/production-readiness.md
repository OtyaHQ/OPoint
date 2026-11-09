# OtyaPoint production readiness runbook

This runbook reflects the current Cloudflare-first direction. It is a release gate checklist, not a claim that production readiness has been achieved. Keep live money movement disabled until every applicable gate is verified.

## 1. Canonical runtime

- Source of truth: GitHub repository `PeterSmartLink/OtyaPoint`.
- API runtime target: Cloudflare Worker `otyapoint-api`.
- Business database target: Cloudflare D1 `otyapoint-db`.
- Private object storage and recovery snapshots: R2 buckets `otyapoint-private` and `otyapoint-backups`.
- Cache: configured OtyaPoint KV namespace.
- Identity: shared Otya Auth Worker, with OtyaPoint-local staff membership and authorization.
- Transactional email: shared Resend configuration where needed.

The Wrangler configuration disables public `workers.dev` access and declares no custom route. The API Worker is not confirmed deployed. Do not enable a public route until the restricted preview and release gates pass. Never copy secrets into source control or chat.

## 2. Current recovery evidence

On 2026-10-30, SQL snapshots for both `otyapoint-db` and `omnipoint-dev` were uploaded to `otyapoint-backups`, retrieved successfully, and restored into isolated EU D1 databases. The original restores reproduced 35 schema objects, all three baseline migration records, and the nine core business-table row counts. Both snapshots have recorded SHA-256 hashes in `cloudflare-api/README.md`.

On 2026-11-09, migrations `0004–0009` were applied successfully to `otyapoint-restore-verify-20261030` and then to production `otyapoint-db`. Production now records migrations `0001–0009`, contains all 13 expected business tables and required integrity objects, and has zero business rows in all 13 tables. The restore-verification database is now a post-migration test copy, not a pristine baseline.

The 2026-10-30 R2 SQL snapshots remain preserved. On 2026-11-09, a fresh post-migration schema-and-ledger snapshot was written to `otyapoint-backups/d1/otyapoint-db/2026-11-09/post-migration-schema-snapshot.sql` (22,711 bytes; SHA-256 `3a088cc0162ed347343e7873f0c5558f1f13e73296a955b5d76c194236bffba1`). The R2 object was read back and its byte count and SHA-256 matched exactly. All 13 OtyaPoint business tables were confirmed empty when captured. The snapshot was restored into a newly created isolated EU D1 database `otyapoint-restore-verify-20261109`; verification found all nine migration-ledger records, 13 business tables, 36 indexes, 18 triggers, and zero business rows. This is a schema-and-ledger recovery snapshot, not a recurring full D1 export. PR #120's scheduled export workflow remains unverified until its dedicated GitHub Actions Cloudflare API token and account-ID variable are configured and a scheduled/manual export succeeds. Retention and failure alerting are not yet established.

## 3. Data preservation and canonical database

Verified current state (2026-11-09): `otyapoint-db` is the production OtyaPoint D1 target and its migration ledger ends at `0009_agency_cash_float_book.sql`. `omnipoint-dev` remains a separate legacy database with its own migration-history schema. Do not merge or delete the legacy database until its references, row contents, history, and recovery value are independently reviewed.

- Compare schema definitions, migration history, row counts, and row contents using read-only queries.
- Preserve `omnipoint-dev` and `otyapoint-db` until application bindings and data ownership are confirmed.
- Select one authoritative writable OtyaPoint database only after review. Avoid dual writes.
- Keep R2 snapshots private and test object retrieval/checksums.
- Establish a scheduled backup process, retention policy, failure alert, and recurring isolated restore drill.
- Never delete a database, bucket, KV namespace, or queue merely because its name contains “old” or “dev”.

## 4. Identity, staff access, and owner recovery

- Verify the Otya Auth token contract, issuer, audience, expiry, revocation, and service-to-service authentication expectations.
- The former local HS256 bridge was retired. The current `/api/bridge/products` handler deliberately fails closed with HTTP 503 until a server-side Otya Auth session and staff-membership exchange is implemented. Do not reintroduce locally minted identity tokens.
- Ensure a valid Otya identity does not grant OtyaPoint access without an active local staff membership.
- Test least-privilege roles, company scoping, disabled staff, expired/revoked sessions, and denied requests.
- Create the first manager through a reviewed, authenticated administrative procedure. Do not create a public bootstrap endpoint, store passwords in SQL, or grant a role solely because an email address matches.
- Verify audit records for staff provisioning and privilege changes.
- Test owner recovery without weakening MFA or bypassing normal authorization.

## 5. Application build and CI

- Run GitHub Actions verification and fix failures rather than bypassing security checks.
- Validate D1 migrations and their order.
- Run both SQLite schema test suites, Worker type-checking, Wrangler dry-run bundling, lint, and the dashboard build.
- Use reproducible dependency installation only after a committed lockfile exists and matches the supported Node/npm version.
- Audit legacy Prisma/Supabase imports and remove runtime dependencies only in reviewed, tested changes after the dashboard is migrated to the Cloudflare API.
- Require review and successful checks before merging deployment-related changes.

## 6. Private preview and operational monitoring

- The dedicated API deploy workflow now exists at `.github/workflows/deploy-api.yml`; it validates the mainline release, requires explicit `DEPLOY`, and deploys with `workers_dev=false` and no custom route. It is not yet run because production Worker credentials and the bootstrap/invitation secrets must be provisioned in the OtyaPoint GitHub production environment.
- Deploy only to a restricted private Worker without changing DNS, public routes, or the existing customer-facing site.
- Verify required bindings and secret presence without printing secret values.
- Test health, identity, authorization, inventory, staff, stock adjustments, cash-sale idempotency, ledger balance, and rollback behavior.
- Confirm logs and traces redact sensitive values, and verify alert routing with a controlled non-production alert.
- Test queue producer/consumer behavior, retries, dead-letter handling, and idempotency before attaching a consumer.
- Verify backup schedules, restore procedures, and incident response contacts.

## 7. Payment and financial launch gates

Keep Airtel Money, MTN MoMo, Interswitch/Quickteller, and all real-money actions disabled until:
- Provider approval and sandbox flows are verified.
- Callback signatures, timestamps, replay protection, and idempotency are implemented and tested.
- Timeouts, duplicate callbacks, retries, reversals, reconciliation, and failed/rolled-back transactions are covered.
- Ledger entries remain balanced and immutable, with audit trails for every financial operation.
- Provider IP allow-list requirements are met through an approved, stable egress design if required.
- Applicable Uganda tax, financial-service, consumer, and data-protection obligations have been reviewed with qualified professionals.

## 8. Cleanup policy

A resource is eligible for deletion only after:
1. Its live bindings, code references, queue producers/consumers, and domain dependencies are checked.
2. Its data is inventoried and, if applicable, backed up and restore-tested.
3. A replacement is operational and monitored.
4. The proposed deletion is recorded in a reviewed change.
5. A rollback or recovery path exists.

Never delete canonical Otya Auth/core/store Workers, Otya assets/release artifacts, or any database with unverified data dependencies as part of routine cleanup.

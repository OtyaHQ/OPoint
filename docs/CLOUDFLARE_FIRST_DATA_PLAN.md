# OtyaPoint Cloudflare-first data and cutover plan

## Decision

OtyaPoint is the retail and financial-agency operations product in the Otya ecosystem. Otya Holdings Limited is the intended parent entity and its URSB registration is in progress. Until incorporation and formal merchant re-verification are complete, provider accounts and merchant KYC must remain in the verified individual account holder's legal name. Use Otya or OtyaPoint as a customer-facing brand/trading identity only where the provider permits it; do not submit corporate KYC, claim corporate settlement ownership, or append “Limited” as though registration were complete. Cloudflare is the target runtime and operational data platform; GitHub is source control; Resend is the shared transactional email provider. The dedicated OtyaPoint D1 database remains separate from Otya Auth/Core/Media data. Do not introduce Supabase, Appwrite, or Vercel into the target runtime unless explicitly approved.

This plan does not claim that dashboard migration, service authentication, scheduled backups, or production API deployment are complete.

## Current verified starting points

- Existing Workers `otya-auth`, `otya-core`, and `otya-next` serve separate workloads and must not be repurposed for OtyaPoint writes.
- OtyaPoint D1 `otyapoint-db` and legacy `omnipoint-dev` both exist and have zero rows in the nine core business tables.
- Both databases have matching core business table/index/trigger definitions, but their `d1_migrations` table schemas differ. Preserve each migration history.
- Private R2 buckets `otyapoint-private` and `otyapoint-backups` exist.
- Two point-in-time SQL snapshots are stored and read-verified in `otyapoint-backups`. Both were restored into isolated EU D1 databases with matching 35-object schemas, migration records, and core row counts. See `cloudflare-api/README.md` for object keys and SHA-256 hashes.
- The snapshots are not an automated schedule. Retention, alerting, and recurring restore drills remain outstanding.
- KV `otyapoint-dev-cache` is only for reconstructable cache.
- Queues `otyapoint-dev-jobs` and `otyapoint-dev-jobs-dlq` exist; consumers/retry/DLQ behavior remain unverified.
- The existing Next.js dashboard still uses Supabase Auth and Prisma. It is not yet migrated to the Cloudflare API.
- The current dashboard-to-Worker bridge mints an HS256 token that the Otya Auth verification endpoint has not been proven to accept. Do not enable this bridge until its contract is documented and tested.

## Target responsibilities

| Concern | Primary target | Rules |
| --- | --- | --- |
| Web UI | Existing Next.js app during migration | Keep staff routes protected; never mix fixtures with live data |
| Operational API | Dedicated OtyaPoint Worker | No public route until restricted preview passes |
| Relational business data | Dedicated OtyaPoint D1 | One writable primary; explicit migration history |
| Shared identity | Otya Auth | Verified identity plus active local OtyaPoint staff membership |
| Private documents/receipts | OtyaPoint private R2 | Private by default; authorized short-lived access |
| Backups | OtyaPoint backup R2 plus isolated restore drills | Checksum, retrieval, retention, alerts, and recovery evidence |
| Cache | OtyaPoint KV | Reconstructable short-lived data only |
| Background jobs | OtyaPoint queues | Idempotent consumers, bounded retries, dead-letter alerts |
| Legacy recovery | `omnipoint-dev` D1 and legacy application code | Preserve until canonical DB and cutover decision are reviewed |

## Data ownership and migration

1. Do not query Otya Auth/Core/Store databases for OtyaPoint business writes.
2. Keep staff membership, company-scoped products, inventory, retail sales, agency transactions, reconciliation, audit events, and ledgers in OtyaPoint-owned tables.
3. Derive `company_id` from verified local staff membership, never from request bodies.
4. Use stable verified identity subjects from Otya Auth. Do not copy passwords, refresh tokens, or signing secrets into OtyaPoint.
5. Do not copy legacy records until a migration mapping and row-level comparison are approved.
6. Do not dual-write a financial operation to two systems.
7. Keep both D1 snapshots and source databases until one authoritative writer is chosen and rollback is tested.

## Required D1 acceptance tests

- Schema migration is repeatable and adds no sample/business rows.
- Foreign keys, unique SKU, unique receipt and unique idempotency constraints behave correctly.
- Sale posting atomically creates sale, lines, stock movement, balanced retail ledger entries and audit record.
- Insufficient stock, inactive products, duplicate requests, and database failures do not leave partial sales.
- Concurrent sale attempts cannot drive inventory negative.
- Retail and agency ledger totals are checked independently.
- Agency status remains pending/unknown until provider truth is verified.
- Reconciliation is ledger-derived, auditable, and supports independent approval.
- Backup restore preserves schema, rows, migration history, stock totals, ledger balance and audit continuity.

The Python SQLite suite validates schema and trigger behavior only; Cloudflare D1 integration tests remain required.

## Release sequence

1. Contract-test Otya Auth-to-OtyaPoint service authentication and local staff authorization.
2. Migrate the dashboard behind a server-side API boundary; replace Supabase/Prisma runtime imports only after acceptance tests pass.
3. Validate product and stock APIs, then cash POS atomicity, idempotency, concurrency and rollback.
4. Establish scheduled R2 backups, retention, failure alerts, and recurring isolated restore drills.
5. Keep payment-provider execution disabled until provider contracts, callback verification, settlement and compliance controls pass.
6. Deploy a restricted preview Worker without a custom domain; verify logs, failure behavior, bindings and access.
7. Apply production schema and deploy public API only after approval and successful gates.
8. Perform a controlled one-writer cutover and retain a tested rollback path.
9. Retire the legacy database only after a separate explicit review.

## Safety rules

- No provider execution, DNS cutover, production migration, secret rotation, or legacy database deletion is implied by this plan.
- Never put secrets, payment credentials, national ID numbers, or unnecessary personal data into logs or backups.
- A build, health check, or successful restore does not prove partner readiness or regulatory compliance.

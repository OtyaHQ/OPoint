# OtyaPoint Cloudflare API

OtyaPoint is the shop and financial-agency operations product within the Otya ecosystem. The Worker currently uses Cloudflare Workers + D1 and a private Otya Auth service binding. GitHub is the source-control/release system and Resend remains behind Otya Auth for transactional email. R2 backup objects remain in the account for recovery, but R2, KV and Queues are not bound to this Worker until an implemented feature needs them.

## Current verified state

- Wrangler config names the API Worker `otyapoint-api` and binds D1 `DB`, the private Otya Auth service, first-owner/invitation secrets, and four Quickteller Business Secrets Store entries scoped only to this Worker. R2, KV and Queues are deliberately not active Worker dependencies because the current API does not use them.
- `workers_dev = false`; no custom route is configured. The live Cloudflare account reports a published private Worker deployment with its `workers.dev` subdomain disabled. This does not certify the dashboard is connected or make the API publicly reachable.
- The isolated D1 recovery snapshot recorded the original applied baseline `0001_core.sql`, `0002_company_scope.sql`, and `0003_staff_profile.sql`; it contained three migration records at the time of the 2026-10-30 snapshot.
- Production `otyapoint-db` now records migrations `0001–0009`; migrations `0004–0009` were applied on 2026-11-09 after the same sequence succeeded on `otyapoint-restore-verify-20261030`.
- Production schema verification found all 13 expected `omni_*` business tables and all required sale-idempotency, sovereign-owner, staff-invitation, append-only ledger/stock/audit, and cash/float indexes/triggers. All 13 business tables were empty at the 2026-11-10 inspection; no owner membership, products, staff or sales had been provisioned at that inspection.
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

The 2026-10-30 exports remain preserved as original baseline recovery points. On 2026-11-09, a new production schema-and-ledger recovery snapshot was captured after migrations `0001–0009`:

| Purpose | R2 object key | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Post-migration production schema and migration ledger | `d1/otyapoint-db/2026-11-09/post-migration-schema-snapshot.sql` | 22711 | `3a088cc0162ed347343e7873f0c5558f1f13e73296a955b5d76c194236bffba1` |

The object was downloaded from R2 and its byte count and SHA-256 matched exactly. It is a schema-and-ledger snapshot, not a recurring full D1 export. All 13 OtyaPoint business tables were verified empty at capture time. The snapshot was restored into a newly created isolated EU D1 database `otyapoint-restore-verify-20261109`; verification found nine migration records, 13 business tables, 36 indexes, 18 triggers and zero business rows. The earlier `otyapoint-restore-verify-20261030` was also used to apply/test migrations `0004–0009`; it is not a pristine pre-migration database anymore. The scheduled backup workflow was added in PR #120 and merged, but its first full export still requires the dedicated Cloudflare D1 Write + R2 Read/Write token and GitHub Actions account-ID variable/secret. Keep all historical snapshots and both verification databases until retention and cleanup are separately reviewed.

## Local development

```sh
npx wrangler dev --config wrangler.toml
python3 cloudflare-api/tests/test_core_schema.py
python3 migration/d1/test_schema.py
npm run check:worker
```

Local SQLite tests validate schema invariants; they do not prove Cloudflare D1 concurrency, deployed authentication behavior, or production readiness.

Migration `0004_sale_request_fingerprint.sql` adds a nullable fingerprint to bind a retail-sale idempotency key to its canonical payment method and normalized product/quantity list. Legacy rows remain unverified because their original request payload was not stored; retries for those rows intentionally return HTTP 409 rather than falsely claiming an exact replay. It is now applied in both production and the isolated restore-verification database. Existing historical rows were empty at migration time.

## API surface

- `GET /health`: schema readiness only. Returns ready only when the complete current table/index/trigger contract is present, including staff invitations, append-only financial/audit guards, and the local agency cash/float book; partial schema returns HTTP 503.
- `GET /api/me`: verified Otya identity mapped to active local staff membership.
- `GET /api/products`: authenticated inventory read.
- `POST /api/products`: manager-authorized product creation with audit record.
- `POST /api/stock-adjustments`: manager-authorized audited stock movement.
- `POST /api/sales`: cash-only retail sale with idempotency and ledger/audit records.
- `GET /api/summary` and `GET /api/ledger`: manager-authorized views.
- `POST /api/bootstrap/sovereign`: one-time secret-gated first-owner provisioning.
- `GET /api/staff`, `PATCH /api/staff/:id`: owner-controlled staff access administration.
- `GET/POST /api/staff/invitations`, `POST /api/staff/invitations/accept`, and owner resend/revoke actions: email-bound staff invitation flow; accepted memberships remain PENDING until owner activation.
- `GET /api/agency-readiness`: manager-only, company-scoped local agency counts; reports Interswitch Marketplace Routing and Quickteller Business separately, alongside Airtel Money and MTN Mobile Money; all remain not ready and the route performs no provider calls or writes.
- `GET /api/agency-overview`: read-only operational totals and the latest ten agency records; managers see company records, other staff see only their own; confirmed amount/commission totals include only provider-confirmed successes.
- `POST /api/integrations/quickteller/sandbox-auth`: SOVEREIGN-only, owner-authenticated sandbox OAuth diagnostic. It returns sanitized configuration/authentication metadata, never a token or credential, and does not initiate or verify a transaction.
- `POST /api/agency-transactions`: disabled; no provider call is made and no transaction is represented as successful.

## Identity and dashboard integration

Otya Auth is the intended identity provider. OtyaPoint separately authorizes local staff memberships and roles; a global Otya login alone must never grant shop access.

The current Next.js dashboard still imports Supabase Auth and Prisma. The former `/api/bridge/products` route that minted a local HS256 token was retired; the current route deliberately fails closed with HTTP 503 until the approved Otya Auth session and OtyaPoint staff-membership exchange has been implemented and tested. Do not reintroduce locally minted identity tokens or trust browser-supplied roles.

Migrate the dashboard behind a server-side API boundary in reviewed steps. Do not remove legacy packages or migrations until all runtime imports, login/session flows, staff provisioning, and UI data paths are migrated and tested. Do not add Supabase, Appwrite, or Vercel to the new runtime unless explicitly approved.

## Owner bootstrap and staff administration

The first owner is provisioned through `POST /api/bootstrap/sovereign`. This route is unavailable unless a high-entropy `OTYAPOINT_BOOTSTRAP_SECRET` has been configured directly as a Cloudflare Worker secret. The request also requires a valid Otya Auth bearer token. A durable audit record and a unique partial index make the bootstrap one-time per company.

Provisioning sequence:

1. Migrations `0004–0009` are already applied to production `otyapoint-db` and tested on isolated restore-verification databases. Do not rerun them. Migration `0009` creates a local operator-recorded cash/float book; it does not enable provider execution. The dedicated API Worker is deployed privately. A gated private deployment workflow is available at `.github/workflows/deploy-api.yml`; it requires production GitHub environment credentials and exact manual `DEPLOY` input.
2. Configure a unique high-entropy `OTYAPOINT_BOOTSTRAP_SECRET` as a Worker secret, never as a Wrangler variable or browser value.
3. The owner calls `POST /api/bootstrap/sovereign` with their own Otya Auth bearer token, the bootstrap secret in `x-otyapoint-bootstrap-key`, and an optional display name.
4. Remove the bootstrap secret immediately after successful owner provisioning. The audit marker keeps the route consumed after the secret is removed.

After bootstrap, the active SOVEREIGN owner can list staff with `GET /api/staff`, create invitations with `POST /api/staff/invitations`, list/review invitations with `GET /api/staff/invitations`, resend with `POST /api/staff/invitations/:id/resend`, revoke with `POST /api/staff/invitations/:id/revoke`, and update memberships with `PATCH /api/staff/:id`.

The owner invitation endpoint accepts an email address, a non-SOVEREIGN role, and optional branch/agent metadata. The API generates a 256-bit one-time code, stores only its SHA-256 digest in D1, and sends the code through the private OtyaPoint-to-Otya Auth service binding. Otya Auth sends the email via the existing Resend account; no second email provider or OtyaPoint Resend API key is introduced.

The invited person must sign in to their own Otya Account and accept with `POST /api/staff/invitations/accept`. Acceptance requires the verified Otya Auth email to match the invitation. The token is consumed once, and the membership is created as `PENDING`; the SOVEREIGN owner must explicitly activate it. The invitation is time-limited, revocable, and re-sendable with token rotation. Raw invitation tokens are never stored in D1 or returned to the owner browser.

Private invitation delivery now uses the account-level Cloudflare Secrets Store. The same high-entropy `OTYAPOINT_INVITE_SERVICE_TOKEN` is bound to the OtyaPoint API and Otya Auth Worker through purpose-specific `secrets_store_secrets` bindings. The Auth Worker additionally requires the service-binding marker `x-otya-service: otyapoint`; the shared secret is checked with constant-time digest comparison. The one-time `OTYAPOINT_BOOTSTRAP_SECRET` is separately bound only to OtyaPoint. Neither value is kept in GitHub Actions or Wrangler variables. Invitation delivery remains fail-closed until both updated Workers are deployed.

Membership listings omit the underlying Otya identity subject and remain company-scoped. Migration `0008_append_only_history.sql` prevents updates/deletes to financial ledger entries, stock movements and audit events; corrections must use compensating records. Invitation creation, delivery outcome, acceptance, status/role changes, revocation and bootstrap are recorded in the business audit stream. Do not provision either secret or run owner bootstrap until the Otya Auth session, service-token exchange, first-owner identity, and deployment route are verified. The current production staff-membership table is empty; no owner has been bootstrapped.

## Money movement and production

Agency-provider transactions remain disabled. No public endpoint, custom domain, live payment-provider operation, or production cutover is enabled by this configuration. Before activation, verify signed provider callbacks, replay protection, idempotency, timeout/retry/reversal handling, reconciliation, balanced ledger invariants, backup schedule/restore drills, alert delivery, and applicable Uganda compliance requirements.


## Isolated local multi-Worker development (2026-11-09)

The safe local runtime is defined by the root `wrangler.local.toml` and `wrangler.auth-local.toml` files. Start it with:

```sh
npm run dev:local:check
npm run test:local-auth
npm run dev:local
```

The first config starts the OtyaPoint API with a local-only D1 simulation. The second config starts a synthetic Auth verifier and is attached through a local service binding. No unused R2, KV or Queue simulations are created. The synthetic verifier accepts only `Bearer otya-local-test-token` and returns the test identity `synthetic-otyapoint-local-owner`. It is not Otya Auth and must never be deployed or used for production authentication.

The local bootstrap applies the checked-in migrations to Wrangler's local D1 state and upserts one synthetic `SOVEREIGN` staff membership. It inserts no business, customer, inventory, sale, cash, float, ledger or payment rows. No provider credentials or live provider adapters are configured.

Run the full local smoke test using `npm run test:local-runtime`. It verifies schema readiness, the synthetic Auth-to-staff mapping, and that `POST /api/agency-transactions` returns HTTP 501 without calling a provider. Wrangler commands are pinned to version 4.158.0 for repeatable tooling.

Never run these commands with `--remote`, never add `remote = true` to a binding, and never deploy either local Wrangler config. The regular `wrangler.toml` and live Otya Auth service remain separate release concerns.

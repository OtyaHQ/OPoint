# OtyaPoint

**OtyaPoint** is the retail and mobile-money agency operations application in the Otya ecosystem.

It brings together shop inventory, retail sales, staff access, agency operations, cash and float controls, reconciliation and business reporting. Retail money and agency money remain separate records.

## Current architecture

- **Otya End** provides shared Otya identity and selected ecosystem services.
- **OtyaPoint API** is a product-scoped Cloudflare Worker with its own D1 data store and authorization rules.
- **Cloudflare D1** owns OtyaPoint products, stock, sales, staff memberships, audit events and future agency records.
- **Cloudflare R2** is reserved for private business files and protected backups.
- **Cloudflare KV and Queues** are for short-lived/reconstructable state and approved asynchronous jobs.
- **Resend** is reused through Otya Auth for transactional messages; OtyaPoint does not need a separate mail provider.
- **GitHub Actions** validates source and configuration. Production deployment and remote migrations remain separately approval-gated.

The regular `wrangler.toml` identifies the isolated OtyaPoint API configuration and its D1 database `otyapoint-db`. The connected Cloudflare account has a deployed `otyapoint-api` Worker, but it remains private: `workers_dev = false`, with no public route or custom domain attached. Production D1 migrations `0001–0009` are applied; all 13 OtyaPoint business tables were empty at the 2026-11-10 inspection. The dashboard is not yet certified as connected to this API. A deployed private Worker is not a customer-facing service.

## Product boundaries

- OtyaPoint owns its shop and agency business records.
- Otya Auth owns the shared Otya account identity; OtyaPoint separately grants shop access through local staff memberships.
- Otya Core, Otya Media and Otya Next do not read or write OtyaPoint business tables directly.
- Retail sales/COGS and agency cash/float/settlement/commissions must remain distinct.
- A provider transaction is not successful until verified provider status confirms it. Unknown outcomes remain unresolved until reconciled.

## Implemented backend foundations

Financial and operational history is protected at the database layer: migration `0008_append_only_history.sql` prevents updates/deletes to ledger entries, stock movements and audit events. Corrections must be recorded as compensating/new events. **Production `otyapoint-db` now records migrations `0001–0009` (verified 2026-11-09).** The `0004–0009` sequence was first applied successfully to the isolated restore-verification D1 database, then to production after confirming the production baseline matched and all 13 business tables were empty. The production schema now contains the sale-idempotency, owner/staff invitation, append-only history and agency cash/float foundations.


The Cloudflare API source includes authenticated product and stock routes, cash-only retail sale posting with idempotency and ledger/audit records, a one-time secret-gated first-owner bootstrap, and owner-controlled email invitations. Staff invitations use hashed one-time tokens, require the invited person's own verified Otya identity and matching email, expire, can be revoked or resent, and create PENDING memberships. The owner must explicitly activate a membership.

The agency-provider write route remains disabled. No MTN, Airtel, Interswitch or Quickteller provider request is enabled by this source change.

## Frontend integration contract

See [the frontend–backend connection contract](docs/FRONTEND_BACKEND_CONNECTION_CONTRACT.md) for the approved API boundary, neutral empty/error states, session migration requirements and the current unconnected dashboard status.

## Migration status and data safety

The Next.js dashboard still contains a legacy Prisma/PostgreSQL and Supabase authentication/data path. Its Cloudflare inventory bridge is deliberately disabled because the previous locally minted token was not an approved Otya Auth identity contract. Do not treat the legacy dashboard and the new Cloudflare API as one migrated system yet.

Do not remove Prisma/Supabase packages, their existing source data, or compatibility routes until:
1. All active dashboard login/session and inventory routes use the approved Otya Auth + OtyaPoint API contract.
2. Existing business data is exported and reconciled against the approved destination.
3. The restored destination is verified using row counts and business invariants.
4. The dashboard is switched to one writable primary and old paths are retired deliberately.

No dual writes. Do not delete a database or backup because it appears empty or redundant.

## Local development

Use the isolated multi-Worker local runtime:

```sh
npm run dev:local:check
npm run test:local-auth
npm run dev:local
```

The local API uses simulated D1, R2, KV and Queues and a synthetic Auth service binding. It does not call the deployed Otya Auth Worker and does not insert shop, customer, stock, sale, cash, float, ledger or payment records.

For the complete local runtime verification:

```sh
npm run test:local-runtime
```

Never add `remote = true`, `--remote`, production identifiers or live secrets to a local config. Never deploy the local Wrangler files.

## Money movement and release safety

Provider integrations, EFRIS submissions, mobile-money collections/disbursements, bill payments and float purchases remain disabled until the exact Uganda product contracts, credentials, callback verification, replay protection, idempotency, status enquiries, reconciliation, settlement controls, operational support and applicable compliance requirements have been reviewed. Quickteller Business is a separate adapter from InterSwitch Marketplace Routing; see [Quickteller Business readiness](docs/QUICKTELLER_BUSINESS_READINESS.md).

A source merge is not a production deployment. Never apply source migrations to a remote D1 database just because they are present in the repository. Require an independently verified recovery point and a reviewed rollback plan first.

## Public-facing product identity

Customer and staff-facing branding should use **OtyaPoint**. The historical repository slug, older source identifiers, and legacy database/resource names may remain where needed for compatibility; they are not the public product name.

---

**OtyaPoint · Otya OS**

# OmniPoint

OmniPoint is the retail and financial-agency operations system for Otya Hold Ltd T/A OmniPoint, the owner's own business in Uganda.

## Current implementation status

The repository contains a responsive Next.js dashboard, an existing PostgreSQL/Supabase-based app foundation, and a separate Cloudflare Worker/D1 migration path. The Cloudflare API work is now being developed as an isolated service with its own schema and configuration. It is not yet connected to the production dashboard and is not ready to execute mobile-money or bill-payment operations.

The original OmniPoint-specific Cloudflare resources remain isolated and undeployed. A fresh development stack now exists: EU-jurisdiction D1 database `omnipoint-dev`, separate development R2 buckets, a development-only KV namespace and queues. The core, company-scope and staff-profile migrations were applied to that new D1 database, and the core business tables were verified empty. No Worker has been deployed from the new configuration; no custom domain or payment-provider operation is active. The unused older OmniPoint-only D1 databases, R2 buckets, KV namespace and queues have been removed after verifying no deployed Worker depended on them. Existing Otya resources were not changed.

**Do not treat a successful build or health endpoint as proof that OmniPoint is production-ready.** Staff token issuance, Otya Auth integration, secure staff provisioning, end-to-end POS tests, backup/restore, and operational approval remain release gates.

## Architecture direction

- **Cloudflare-first runtime and data:** a dedicated OmniPoint Worker, D1 for relational operational data, private R2 for protected documents/receipts/exports, KV only for reconstructable short-lived state, and Queues for retryable asynchronous work.
- **Shared Otya identity, separate authorization:** use the approved Otya Auth identity flow where appropriate, then map the verified identity to an active OmniPoint staff membership and locally assigned role.
- **Isolated business data:** OmniPoint products, stock, sales, agency operations, reconciliation and ledgers are not stored in Otya Auth/Core/Player databases.
- **Separate ledgers:** retail sales and cost of goods are distinct from agency cash, float, provider settlement and commissions.
- **Provider truth:** an agency transaction is not successful until a verified provider response/status confirms it. Provider execution remains disabled until partner contracts, credentials, callbacks, reconciliation and compliance controls are implemented.
- **Offline-friendly counter:** the staff interface should be touch-friendly and handle poor connectivity without pretending that an unconfirmed transaction succeeded.

See [the ecosystem contract](docs/ECOSYSTEM_CONTRACT.md), [the Cloudflare inventory](docs/CLOUDFLARE_RESOURCE_INVENTORY.md), and [the implementation gates](docs/OMNIPOINT_BUILD_GATES.md).

## Development

Requirements: Node.js 20.9+ and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000.

Existing application checks:

```sh
npm run db:validate
npm run lint
npm run build
python3 migration/d1/test_schema.py
python3 cloudflare-api/tests/test_core_schema.py
```

## Owner and staff provisioning

The Cloudflare API has a one-time secret-gated owner bootstrap and an email-bound staff invitation flow. Otya Auth verifies identities and sends invitations through the existing Resend transport. Invitation tokens are hashed at rest, expire, can be revoked or rotated, and create only PENDING staff memberships. The owner must activate each membership. Agency-provider writes remain disabled.

## Cloudflare API work

- `wrangler.toml` is the single configuration and points only to the isolated `omnipoint-dev` database and development resources.
- It has `workers_dev = false`; no Worker has been deployed from this configuration, and no public route or custom domain is configured.
- Use `npm run dev:local` for local development. It selects dedicated local configs, adds `--local`, and uses a synthetic Auth Worker rather than the deployed Otya Auth service. Do not use `--remote` or deploy the local configs.
- Business routes validate Otya Auth through a service binding, then require an active local OmniPoint staff record. Browser-supplied roles are never trusted.
- Cash POS posting is designed around a D1 batch with stock guards, stock movements, balanced retail ledger entries and audit logging. Concurrency, idempotency and rollback tests remain required.
- Agency transactions remain disabled until provider adapters, cryptographic callback verification, status reconciliation and settlement controls are ready.

## Data migration and recovery

The older PostgreSQL/Supabase implementation must be treated as a legacy source/recovery copy during this transition, not as a second live writer. Do not dual-write financial records to PostgreSQL and D1. Do not delete the existing Supabase project or its records as part of this feature branch.

Before cutover, export and verify the approved data set, compare row counts and business invariants, test an isolated restore, and choose one writable primary. Follow the [Cloudflare resource inventory](docs/CLOUDFLARE_RESOURCE_INVENTORY.md) and [build gates](docs/OMNIPOINT_BUILD_GATES.md).

## Business and security boundaries

- Public self-registration is not allowed for staff.
- Staff access must be provisioned through a secure owner/management process.
- Roles and branch permissions are read from server-side OmniPoint records, never trusted from browser payloads.
- Do not store raw national ID numbers or identity-document images unless an approved, compliant requirement is established.
- Never commit credentials, database URLs, signing keys, provider secrets, or production data.
- No EFRIS, mobile-money, airtime or bill-payment integration should be represented as live until provider approval and end-to-end verification are complete.


## Safe local development environment (2026-11-09)

Use the dedicated local multi-Worker setup instead of pointing local development at the regular Wrangler config:

```sh
npm run dev:local:check
npm run test:local-auth
npm run dev:local
```

The local API and synthetic Auth verifier run together through Wrangler's local service binding. The API uses a local D1 database, local R2 buckets, local KV and a local Queue simulation. The mock verifier accepts only the documented synthetic local token; it does not call the deployed Otya Auth Worker. The local seed creates one synthetic staff identity only. It does not insert products, customers, sales, cash, float, ledger entries or payment records.

For the full local smoke test, including schema migrations, identity-to-staff mapping and the disabled agency-payment endpoint:

```sh
npm run test:local-runtime
```

This smoke test must remain local-only. Never add `remote = true`, `--remote`, production identifiers, live secrets, custom domains or payment credentials to either local Wrangler config. The existing `wrangler.toml` remains a separate isolated Cloudflare configuration; production remains a separate, approval-gated release decision.

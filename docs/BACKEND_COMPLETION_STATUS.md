# Opoint backend completion status

**Environment:** isolated Cloudflare staging  
**Release state:** development foundation, not production-ready  
**AI:** disabled  
**Financial/provider execution:** disabled

## Verified foundation

- Product-owned Worker: `opoint-api-staging`.
- Product-owned D1: `opoint-staging-db`.
- Product-owned private R2 bucket: `opoint-private-documents`.
- D1 catalogue: 44 application tables, 19 indexes, 9 integrity triggers and 1 journal-balance view.
- Schema migration ledger: 3 entries. Foreign-key check: no violations.
- No company, staff membership, product, sale, payment intent, agency operation or audit-event rows in staging at the 2026-11-11 verification.
- Opoint backend CI, schema validator, security baseline and staging smoke workflows have passed on the current rebuild PR.

## Current API surface

- Health, capabilities and authenticated identity summary.
- Company creation with idempotency.
- Product listing and product creation.
- Read-only overview, customers, suppliers, categories, stock, sales, cash accounts/sessions, purchases, expenses, reconciliation, ledger entries, payment intents, agency operations, billers and integration status.

The existence of a database table does not mean the corresponding business workflow is implemented. In particular, payment intents and ledger entries are currently exposed as read-only operational views.

## Completion sequence

1. Replace the legacy identity binding with the reviewed Otya ID service contract. Test session expiry, refresh, logout/revocation, suspended identities, role resolution and service-binding failure.
2. Complete owner onboarding, company/branch creation, staff invitations, branch assignment, role grants, suspension and audit history.
3. Finish catalogue and inventory writes: categories, customers, suppliers, product updates, stock receipts, transfers, returns and controlled adjustments.
4. Implement sale lifecycle: draft, validate stock, calculate totals/tax/discount, collect split payments, commit inventory and append balanced double-entry journals in an atomic D1 batch.
5. Complete cash sessions, till variance, agency cash-in/out recording, float balances, commissions, reversals and end-of-day close.
6. Implement provider adapters as separate sandbox-only modules for MTN MoMo, Airtel Money, Quickteller Business and InterSwitch. Add signed callback verification, idempotency, status polling, unknown-outcome handling, reconciliation and compensation.
7. Add biller catalogue synchronization, validation, airtime/data and bill-payment workflows; keep real-money actions disabled pending contracting and Uganda compliance approval.
8. Add EFRIS document metadata and submission only after the required provider/legal setup is confirmed.
9. Build the server-side dashboard session bridge and replace active Supabase/Prisma paths. Only then consider removing the Supabase packages, migrations, environment variables and old auth files.
10. Add backup/restore rehearsal, retention, incident response, load/concurrency tests and operational alerts.

## Legacy dependency rule

Supabase is not a target runtime, but its Auth/Prisma code is still called by the current Next.js login and staff-management routes. It is therefore **legacy but not yet dead code**. Do not delete it until Otya ID authentication and Cloudflare API-backed staff workflows pass end-to-end browser tests and a restorable backup is verified.

## Hard release gates

- No direct browser writes to D1 and no client-supplied trusted identity or role.
- Every company/branch query and mutation must be scope-checked server-side.
- Every financial write must be integer UGX, idempotent, auditable and reconciled.
- Journal entries must balance and be immutable once posted.
- Provider calls occur outside D1 transactions through intent/outbox state transitions.
- FCM/email notifications are hints only; API/provider state remains authoritative.
- No live provider credentials or production money movement until explicit legal/provider approvals and owner release approval.
- AI is read-only, product-scoped and disabled until its own acceptance gates pass.

Canonical platform contract: [Otya End product backend and identity boundaries](https://github.com/OtyaHQ/OEnd/blob/product-ai-isolation-foundation-2026-11-11/docs/PRODUCT_BACKEND_AND_IDENTITY_BOUNDARIES.md).

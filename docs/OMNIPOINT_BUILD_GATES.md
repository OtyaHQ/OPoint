# OtyaPoint implementation and release gates

This file records verified implementation status, not a claim that the full product is production-ready. The customer-facing product name is **OtyaPoint**; historical source/table prefixes remain for compatibility.

## Stage 0 — Cloudflare foundation and database

- [x] Dedicated OtyaPoint production D1, private R2 buckets, KV and queue resources inventoried.
- [x] Dedicated production Worker configuration reviewed; it disables `workers.dev` and has no public route.
- [x] Production D1 records migrations `0001–0009`.
- [x] Migrations `0004–0009` validated first on the isolated restore-verification database, then applied to production after checking the production baseline.
- [x] Production schema has 13 OtyaPoint business tables, 36 indexes and 18 triggers.
- [x] All 13 production business tables were verified empty when migrations were applied and rechecked read-only on 2026-11-10; no owner, products, staff, sales or ledger records are provisioned.
- [x] A 2026-11-09 schema-and-ledger snapshot was uploaded to private R2, SHA-256 read-back verified, and restored into a new isolated EU D1 database.
- [x] The dedicated `otyapoint-api` Worker is deployed privately to Cloudflare with a 100% deployment version (verified 2026-11-10); `workers_dev` is disabled and no public route or custom domain is attached.
- [ ] The scheduled full D1 export workflow has completed its first successful run.
- [ ] Recurring recovery alerts and retention policy are established.

## Stage 1 — Identity and staff authorization

- [x] Worker source verifies bearer access tokens through the shared `otya-auth` service binding.
- [x] Every protected business route maps the verified identity subject to an active company-scoped OtyaPoint staff membership.
- [x] Local roles, membership status, company scope and owner bootstrap constraints are present in the schema.
- [x] One-time staff invitations use random tokens whose SHA-256 digests are stored; acceptance requires the invitee's own verified Otya identity and matching email.
- [x] Invitation and owner bootstrap paths fail closed if their required secrets are absent.
- [x] The private API Worker has its account-level owner-bootstrap and staff-invitation secrets bound; secret values remain protected and were not read.
- [ ] First owner is provisioned through the verified one-time flow.
- [ ] A same-origin dashboard session BFF is implemented with HttpOnly/Secure/SameSite cookies, CSRF/origin checks, refresh rotation, logout revocation and replay tests.
- [ ] Browser/device sign-in and least-privilege access tests pass against the deployed services.

## Stage 2 — Retail inventory and point of sale

- [x] Source includes company-scoped product and stock APIs.
- [x] Source includes cash-only retail sale posting with request fingerprinting and idempotency.
- [x] Sale-line triggers enforce company/product availability and stock deduction.
- [x] Append-only ledger, stock-movement and audit protections are implemented in D1.
- [x] Worker source and migration/runtime tests pass in CI and the isolated D1 restore.
- [x] API Worker is deployed privately at 100% (verified 2026-11-10).
- [ ] End-to-end health, authentication, inventory and sales checks pass against the deployed services.
- [ ] Dashboard has migrated from legacy Prisma/Supabase inventory and sales writes to the OtyaPoint API.
- [ ] Receipt, returns/refunds, reporting and reconciliation workflows are verified against real shop procedures.
- [ ] EFRIS integration is separately approved and validated; it remains unconfigured.

## Stage 3 — Mobile-money and agency operations

- [x] Local operator-recorded cash/float accounts, agency operations, account movements and append-only guards are implemented in D1.
- [x] Read-only agency overview/readiness source routes distinguish local operator records from provider-confirmed transactions.
- [x] An InterSwitch bills sandbox client exists as an isolated adapter and is not wired into customer-facing routes.
- [x] MTN MoMo, Airtel Money, Interswitch and Quickteller are kept distinct in the provider readiness model.
- [ ] Provider write routes remain disabled until credentials, partner approval, signature/callback verification, status enquiry, replay protection, idempotency, settlement, reversals and reconciliation are independently validated.
- [ ] Provider IP allow-list/stable egress requirements and applicable Uganda obligations are reviewed before live money movement.
- [ ] No provider result is represented as successful without verified provider status.

## Stage 4 — Jobs, storage, backups and observability

- [x] Private R2 buckets exist for OtyaPoint business files and backups.
- [x] 2026-10-30 historical SQL snapshots remain preserved.
- [x] A 2026-11-09 post-migration schema-and-ledger snapshot has been uploaded, read-back checksum verified and restored to a disposable EU D1 verification database.
- [x] D1 backup automation code is merged and has unit tests for export polling, bounded downloads, checksum and safe key generation.
- [ ] Configure the dedicated GitHub Actions Cloudflare account ID and backup API token, then confirm a scheduled/manual full D1 export succeeds and is read-back verified.
- [ ] Define retention, failure alerts and recurring restore drills.
- [ ] Queue consumers, retries and dead-letter handling are connected only after each handler is idempotent and tested.

## Stage 5 — Dashboard and shared ecosystem integration

- [x] The dashboard's old locally minted identity-token bridge is disabled and fails closed.
- [x] A frontend/backend connection contract documents the required BFF, API routes and failure states.
- [x] A gated private API deployment workflow has been added to `.github/workflows/deploy-api.yml`.
- [ ] Complete a protected-main release through GitHub Actions using verified production environment credentials, then run the deployment and smoke-test gates.
- [ ] Deploy the Next.js dashboard on a verified Cloudflare runtime and add a private service binding to `otyapoint-api` and `otya-auth`.
- [ ] Implement secure same-origin login/session and server-side API proxy routes.
- [ ] Replace dashboard Supabase/Prisma business-data paths only after the replacement is end-to-end verified and existing records are reconciled.
- [ ] Make the overview, POS, inventory, staff, agency, reconciliation and reports screens display only authoritative API responses.
- [ ] Verify touch/mobile UX, poor-network handling, receipts, empty/error states and accessibility.
- [ ] Publish public-safe integration documentation through OtyaHub.

## Stage 6 — Release decision

A public or financial release is blocked until all applicable items above are complete. A green build, a deployed private Worker, or a healthy database alone is not proof of a functioning customer-facing OtyaPoint system.

Production changes must retain:
1. CI, type, schema, security and integration checks.
2. Independently verified recovery points and restore procedures for stateful changes.
3. No browser access to D1, service tokens or provider credentials.
4. Company/branch authorization and append-only audit/ledger controls.
5. Provider truth as the only authority for payment completion.
6. A known deployment target, rollback plan and monitored operational owner.

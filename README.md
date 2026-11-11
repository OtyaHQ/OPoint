# Opoint

**Business operations, retail and financial services — by Otya.**

Opoint is the business product in the Otya ecosystem. It brings retail operations, inventory, cash management, mobile-money agency workflows, bill payments, staff operations and financial reporting into one secure application.

Opoint is a product of **Otya Holdings Limited**. Otya is the ecosystem brand; Opoint is the business application.

## Product principles

- Financial correctness before convenience.
- Server-authoritative balances and transaction states.
- Every financial action is authenticated, authorised, idempotent and auditable.
- Provider timeouts remain unresolved until a trusted status check or callback resolves them.
- Shop cash, customer collections and provider float are separate records.
- Business data is company-scoped and never shared with Omy Play.
- The mobile app remains useful on unstable networks, but offline drafts are not treated as settled financial transactions.
- Configuration is managed by secure backend controls; native capabilities and security fixes still require an app update.

## Product scope

- Retail POS, products, stock, suppliers, purchases, sales, receipts, returns and refunds.
- Business branches, staff, permissions, shift handover and approvals.
- Cashbook, cash drawer, provider float, commissions and reconciliation.
- Mobile-money agency flows for supported providers.
- Airtime, data and bill-payment workflows.
- Payment provider integrations and verified webhook processing.
- Financial journal, audit history, reporting and export.
- Notifications, real-time operational updates and incident alerts.

Provider integrations are independent and must not be conflated: Quickteller Business and InterSwitch Marketplace Routing are separate products. MTN MoMo, Airtel Money and EFRIS also require their own credentials, contracts, environment configuration and approval.

## Technology ownership

| Capability | Primary owner |
|---|---|
| API and business rules | Cloudflare Workers |
| Financial and business records | Opoint Cloudflare D1 |
| Private documents and receipts | Opoint Cloudflare R2 |
| Background event delivery | Cloudflare Queues |
| Authenticated live sessions | Cloudflare Durable Objects / WebSockets |
| Push delivery and mobile integrity | Opoint's dedicated Firebase project |
| Transactional email | Resend through Otya ID / approved Opoint services |
| Source control and release gates | OtyaHQ GitHub organization |

Firebase is a supporting mobile platform, not the financial ledger. Firestore and Firebase Storage are not required for the initial Opoint financial backend.

## Identity and security

Otya ID provides shared account identity and OTP. Opoint owns company membership, branch scope, role permissions and financial authorisation. Telegram may be used as an OTP delivery channel where configured, but Telegram Login is not an authentication method.

Never commit API tokens, service-account keys, provider credentials, signing keys, PINs or production data. Keep secrets in Cloudflare Secrets Store. Do not expose raw provider payloads or sensitive customer references in logs.

## Financial safety rules

- Store UGX values as integer whole-shilling amounts. Do not use floating-point arithmetic for money.
- Post balanced double-entry journal records atomically with the financial state change.
- Never edit posted journal entries; correct them through controlled reversals.
- Require an idempotency key for every money-moving request and provider event.
- Verify webhook signatures before processing and de-duplicate by provider event ID.
- A timeout is not a failure. Keep the state pending/unknown and query the provider before retrying.
- A notification is never proof of payment completion. The app fetches the authoritative state from Opoint.
- Apply company and branch scope on the server on every tenant-owned query.
- Keep sandbox and production credentials, URLs, queues and provider configurations separate.

## Development status

This repository is being rebuilt as a clean company-owned product foundation. Existing code and resources are treated as migration references, not proof of production readiness.

No live customer money movement is authorised by this repository. Use synthetic records and provider sandboxes until the financial, security, provider and reconciliation release gates pass.

## Repository layout

- `cloudflare-api/` — existing API code under audit and rebuild.
- `apps/mobile/` — planned Flutter Android application.
- `docs/` — architecture, provider contracts, security and operational runbooks.
- `foundation/` — clean schema and migration baseline, developed separately from legacy migrations.

## Engineering release gates

A release must pass schema/migration validation, API and authorization tests, financial invariant tests, provider sandbox scenarios, webhook replay and signature tests, failure/retry tests, mobile analysis/build checks, dependency/security scans, backup/restore evidence and a reviewed deployment plan.

See [Architecture](docs/ARCHITECTURE.md), [Firebase setup](docs/FIREBASE_SETUP.md) and [Security](SECURITY.md).

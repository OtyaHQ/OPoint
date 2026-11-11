# Opoint backend foundation

**Status:** implementation baseline — 11 November 2026  
**Product name:** Opoint  
**Ecosystem:** Otya  
**Media product:** Omy Play (renamed brand; its implementation is paused and outside this work)

This document records the current Opoint backend evidence and the release sequence required before the product handles live financial transactions. It is not a declaration that payment services are production-ready.

## 1. Product and infrastructure boundaries

Opoint is an independent business and financial-operations product. It owns its business records, financial ledger, payment-provider transactions, staff memberships, operational notifications and audit history.

Omy Play is a separate consumer media product. Its current application, backend, database, Firebase project, credentials and release pipeline must not be changed by Opoint work. The Omy Play brand rename is recorded here as a product decision only; implementation and migration of the media app are deferred.

The only intentionally shared service at this stage is Otya identity. A verified Otya identity is not sufficient business authorization: Opoint must still resolve an active Opoint staff membership, company scope, branch scope and role on every protected request.

## 2. Current Opoint state — observed

The following was verified from the repository and read-only Cloudflare D1 inspection on 11 November 2026:

- The repository contains a dedicated private Cloudflare Worker configuration and a dedicated Opoint D1 binding.
- The Worker has `workers_dev = false`, no public custom domain configured in this file, and a Cloudflare service binding to Otya Auth.
- The live D1 database reports migrations `0001_core.sql` through `0009_agency_cash_float_book.sql` as applied.
- The schema includes products, retail sales and lines, stock movements, staff memberships and invitations, audit events, ledger entries, reconciliation sessions, agency transactions, agency accounts, cash/float operations and account movements.
- The API verifies the Otya identity token and separately checks active Opoint membership and role.
- Retail sale creation is currently restricted to cash. It uses an idempotency key, request fingerprint, a D1 batch for the sale, sale lines, ledger entries and audit record.
- The agency readiness endpoint explicitly reports that live money is disabled and transaction creation is disabled until provider adapters and controls are verified.
- The agency transaction POST endpoint currently returns `501 provider_adapter_required`; it does not initiate a provider transaction.
- The Quickteller route is a sandbox authentication/credential check, not a payment-initiation implementation.
- The API readiness response lists Interswitch Marketplace Routing, Airtel Money and MTN Mobile Money adapters as not implemented.
- The Worker configuration does not yet declare Opoint device/notification tables, an FCM delivery queue, or a real-time Durable Object binding.
- The web repository still declares Supabase client dependencies and Supabase environment placeholders. These must be traced to actual imports/usages before removal.

The current database and code are foundations. They are not evidence of live payment approval, certified daily operation or a finished Android client.

## 3. Target architecture

### Opoint financial source of truth

- Cloudflare Workers: authenticated business API, provider adapters, callbacks, policy checks and server-side business rules.
- Cloudflare D1: company-scoped business records, double-entry journal, payment lifecycle, cash/float books, reconciliation, notification inbox and audit history.
- Cloudflare R2: private receipts and business documents; use short-lived authorised access rather than public buckets.
- Cloudflare Queues: transactional outbox delivery, notification dispatch, provider polling and reconciliation jobs.
- Cloudflare Durable Objects: authenticated real-time session fan-out or per-company coordination when required. They must not become a second financial ledger.
- Cloudflare Secrets Store: provider secrets, FCM service-account credentials and inter-service secrets.

### Opoint Firebase project

Create a Firebase project dedicated to Opoint (proposed project ID: `opoint-production`, subject to Firebase availability). Register a separate Android app/package identity for Opoint. Keep the existing Omy Play Firebase project separate.

Use Firebase for:
- Firebase Cloud Messaging (FCM) delivery;
- Firebase App Check with Play Integrity on supported release devices;
- Crashlytics;
- Performance Monitoring;
- carefully scoped Analytics;
- Remote Config for client-side settings that are safe to change remotely.

Do not use Firestore or Firebase Realtime Database as a second financial database. Do not store balances, ledger entries, provider transaction truth, staff authorization or authoritative notification history in Firebase.

FCM tokens and delivery outcomes are managed by Opoint's backend. A push notification is a delivery hint, not proof of payment success. The app must refresh transaction status from the Opoint API.

### Opoint mobile client

Build the Android client in Flutter as a separately released client. It communicates only with documented Opoint APIs. Opoint mobile releases must not be coupled to Omy Play releases.

## 4. Financial correctness and safety requirements

Before enabling payment initiation:

1. Monetary amounts are integer minor units in UGX; reject floating-point monetary inputs.
2. Each posted journal transaction has a unique journal/batch identifier and is balanced (total debits equal total credits) before commit.
3. Ledger and audit history are append-only. Corrections use compensating entries, not edits or deletions.
4. Every mutating request has a scoped idempotency key and a canonical request fingerprint. Reusing a key with a different payload is a conflict.
5. Provider transactions have explicit lifecycle states, including pending and unknown outcomes. A timeout must never be interpreted as a failure or automatically retried as a new payment.
6. Provider callbacks are authenticated, signature-verified where supported, replay-protected, idempotent and retained as evidence.
7. Status polling and reconciliation resolve uncertain outcomes against provider records.
8. Cash, provider float, customer funds, fees and commissions are separate accounting dimensions; expected balances reconcile to immutable movement records.
9. Refunds, reversals, chargebacks and manual adjustments are separately authorised and audited.
10. Staff access is company- and branch-scoped with least privilege. Sensitive administrative actions require step-up protection and auditable approvals.
11. Database migrations are additive, reversible where possible, backed up, and verified against a restore copy before production application.
12. Logs and notifications never expose OTPs, tokens, full customer identifiers, provider secrets or full payment credentials.

## 5. Required functional modules

### Retail and POS
- Product catalogue, SKU/barcode, categories and pricing.
- Purchasing, receiving, supplier records and stock movement history.
- Cash sales, discounts, tax metadata, receipts, returns, refunds and void controls.
- Low-stock rules, stock counts and adjustment approvals.
- Daily sales, margin, stock valuation and cash reconciliation.

### Financial operations
- Chart of accounts and double-entry journal.
- Cash drawer, bank/e-money accounts and separate MTN/Airtel provider float.
- Opening balances, deposits, withdrawals, transfers, commissions, fees and settlement.
- Cash-in/cash-out operator workflow with provider confirmation where the provider supports it.
- Transaction history, daily close and reconciliation exceptions.

### Payment and provider integrations
- MTN Mobile Money and Airtel Money: approved authentication, collection/disbursement flows where contracted, callback verification, status checks and reconciliation.
- Interswitch Marketplace Routing: billers, payment items, customer validation, payment initiation and transaction status.
- Quickteller Business: its own separately verified contract, credentials and endpoints; it is not interchangeable with the Interswitch Marketplace Routing API.
- Airtime and data: catalogue, customer validation where available, order/payment, fulfilment confirmation and reversals.
- Provider sandbox contracts and failure simulations before production credentials or live traffic.

Only contracted and approved capabilities may be enabled. A provider appearing in configuration is not proof of connectivity or approval.

### Notifications and real-time operations
- In-app notification inbox stored in Opoint D1.
- Device installation registry and revocable FCM token registration.
- Transactional outbox written atomically with the business event.
- Queue-backed FCM delivery, retry policy, dead-letter handling and delivery telemetry.
- WebSocket updates for active sessions; FCM for background/closed-app alerts.
- User preferences, notification categories, deduplication and quiet-hour policy.
- Real-time status always reconciled with the Opoint API and provider truth.

## 6. Backend-first implementation sequence

1. Baseline the current schema, all API routes, migrations, authorization boundaries, provider clients and deployment workflows.
2. Close core accounting gaps: journal grouping, balance invariants, ledger posting, cash/float lifecycle, reversals and reconciliation.
3. Implement the provider transaction state machine and provider adapters, initially in sandbox only.
4. Implement transactional outbox, device registration, notification inbox, FCM dispatch, and real-time event delivery.
5. Remove unused legacy dependencies only after confirming there are no runtime imports or required migrations.
6. Publish versioned API contracts and certify the web/mobile client integration.
7. Build the Flutter Opoint Android app against those contracts.
8. Run security, concurrency, idempotency, provider-failure, backup/restore and operational acceptance tests.
9. Enable production providers only after credentials, provider approval, reconciliation, support and rollback controls are verified.

## 7. Release gates

No production deployment, remote D1 migration, public API exposure or live-money activation is implied by this baseline. Each requires:
- green required CI and security checks;
- reviewed migration and recoverable backup/restore evidence;
- verified owner/staff access and company isolation;
- provider sandbox evidence and formal provider production approval;
- duplicate, timeout, callback, reversal and reconciliation tests;
- monitoring, alert routing, runbooks and an explicit release decision.

## 8. Naming and compatibility

The public product name is **Opoint**. Existing internal identifiers such as `otyapoint-api`, `OTYAPOINT_*`, legacy `omni_*` database objects and the stable legacy tenant key are compatibility identifiers. Do not rename these in bulk. Public labels can change independently; internal IDs require a separately reviewed migration with rollback and data-integrity evidence.

The media product's new public name is **Omy Play**. Its code, database, Firebase project and infrastructure remain out of scope until a separate media rebrand phase is authorised.

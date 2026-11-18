# Opoint architecture

## 1. Product boundary

Opoint is a standalone business application. It does not share its financial database, notification history, storage buckets or release pipeline with Omy Play. The Otya ecosystem may share identity and controlled service-to-service contracts.

## 2. Runtime

- **Opoint API Worker:** owns business and financial decisions. No client can write directly to D1.
- **D1:** authoritative business data and financial ledger.
- **Queues:** durable asynchronous processing for outbox events, notifications, provider callbacks, reconciliation jobs and reports.
- **Durable Objects:** authenticated real-time sessions and per-business/branch connection coordination. Do not make a single global object a bottleneck.
- **R2:** private receipts, uploaded documents and evidence with short-lived authorised download URLs.
- **Firebase:** FCM delivery, App Check, Crashlytics and mobile diagnostics for the Opoint Android app.
- **Resend:** transactional email through approved Otya email services.
- **Otya ID:** global authentication only. Opoint evaluates its own business membership, branch, role and permissions.

## 3. Financial write path

1. Authenticate the Otya ID session.
2. Resolve active Opoint company membership and branch access from the server.
3. Validate permission, request schema, limits, current business state and idempotency key.
4. Persist the transaction intent and business state in an atomic D1 batch.
5. Post a balanced journal entry; enforce the required debit/credit equality.
6. Write an outbox event in the same D1 transaction.
7. A Queue consumer performs provider calls or notification delivery.
8. Verify provider signatures and reconcile asynchronous status events.
9. Update authoritative transaction status and journal/reversal records atomically.
10. Publish WebSocket and FCM notices; clients then fetch authoritative state from the API.

External payment calls cannot be part of a D1 transaction. Use an explicit payment state machine and an outbox/inbox approach to make retries safe and uncertain outcomes visible.

## 4. Payment state model

At minimum: `CREATED`, `VALIDATING`, `PENDING_PROVIDER`, `SUCCEEDED`, `FAILED`, `UNKNOWN`, `REVERSED`, `EXPIRED`, `MANUAL_REVIEW`.

A client timeout must not mark a transaction failed. A provider callback must be signature-verified, linked to a known provider transaction, de-duplicated, and reconciled against the current state. Never retry a non-idempotent request without first resolving its provider status.

## 5. Provider boundaries

Implement separate adapters and environment configuration for:
- MTN Mobile Money;
- Airtel Money;
- Quickteller Business;
- InterSwitch Marketplace Routing;
- EFRIS.

Do not reuse endpoints, credentials or assumptions across providers. Each provider needs current API contracts, onboarding approvals, sandbox tests, signed callback verification, idempotency mapping, status inquiry and reconciliation.

## 6. Data and privacy

- All monetary values are integer UGX amounts.
- Every tenant-owned table has a company scope; branch scope is enforced by the API.
- D1 has no row-level security. Tenant isolation is an application invariant and must be tested.
- Store only necessary personal data. Hash or mask request metadata that does not need to be retained.
- Keep audit history append-only for sensitive business and financial operations.
- Backups, restore tests and data retention policies are required before production.

## 7. Dynamic backend control

Store business settings, provider availability, feature flags, notification preferences, limits, commission tables, supported currencies, maintenance mode and compatibility policy in versioned server-side configuration.

Do not return secrets in configuration responses. Firebase Remote Config may deliver app presentation/availability controls, but Opoint's Cloudflare configuration is authoritative for business logic and financial limits.

## 8. Separation from Omy Play

Omy Play is a separate product with its own app, Firebase project, database and release workflow. Opoint must not connect to Omy Play's Firebase project, Cloudflare D1 database, R2 bucket, notification topics or user data.

## 9. Environments

Use separate development, staging and production resources. Staging may use synthetic company records and provider sandboxes only. Production secrets and money movement stay disabled until approval and reconciliation test evidence exists.

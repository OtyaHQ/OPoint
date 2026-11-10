# Otya ecosystem integration contract

## Purpose

This contract defines how OtyaPoint relates to Otya products without merging their data, permissions, or production risk. It is the source-of-truth boundary for implementation work across the PeterSmart Link / Otya ecosystem.

## System map

- **Otya Auth (otya-auth)** — shared identity verification only. A successful login does not automatically grant access to any product or business.
- **Otya Core (otya-core)** — shared Otya APIs and release/notification infrastructure. OtyaPoint business transactions must not be implemented by adding OtyaPoint tables or routes to the same production Worker unless a reviewed architecture decision explicitly chooses that coupling.
- **OtyaPoint API (dedicated Worker, planned)** — isolated business API with its own D1 database, R2 namespace, cache namespace, queue and role checks. It is the only service allowed to write OtyaPoint operational records.
- **OtyaPoint web app** — staff-facing UI. It calls the OtyaPoint API; it must not connect directly to D1 or hold privileged credentials.
- **Next (otya-next)** — owner assistant and approved automation interface. It can request scoped API operations but must not bypass OtyaPoint authorization or directly write operational tables.
- **Otya Player** — offline-first media app. Local media remains local by default; its core playback must not depend on OtyaPoint or cloud availability.
- **OtyaHub** — public product, documentation, policy and partner surfaces. Public content must not reveal private infrastructure, user records, or credentials.
- **PeterSmart Link / Otya Hold / OtyaPoint UG Limited** — business and product ownership labels, not database-sharing permissions. Each company, branch, till, and business activity needs explicit tenancy and role scope.

## Ownership rules

| Data domain | Authoritative owner | Sharing rule |
| --- | --- | --- |
| Global Otya identity | Otya Auth | Share stable identity subject only; never copy password or session secrets into OtyaPoint |
| OtyaPoint staff membership, role, branch, approvals | OtyaPoint | Map verified identity to an active local staff record; roles come from server-side records, never browser claims |
| Retail products, stock, sales, receipts, returns | OtyaPoint | Private to OtyaPoint business scope; no Otya Player or public-hub access |
| Agency transactions, provider references, cash/float, commissions | OtyaPoint | Separate agency ledger; provider-confirmed status only; no inferred success |
| Retail ledger and agency ledger | OtyaPoint | Separate ledger types and balanced entries; never silently net against each other |
| Public product information and docs | OtyaHub | Publish only reviewed public-safe material |
| Media files and release metadata | Otya Player / Otya Core release service | No default upload of local libraries or vault contents |
| Owner-assistant conversations and approved action records | Next / Otya Core, according to its existing schema | Tool calls must carry actor, purpose, scope, approval and audit context |
| Shared static assets | Relevant product namespace | Signed/short-lived access for private files; no public bucket for receipts or exports |

## Communication pattern

1. The user authenticates through the approved Otya Auth flow where shared identity is appropriate.
2. The OtyaPoint API sends the access token to the existing Otya Auth Worker through a service binding and accepts only its verified identity response; Auth remains responsible for signature, expiry and token lifecycle validation.
3. The API maps the identity subject to an active OtyaPoint staff membership and loads role, company, branch and permissions from OtyaPoint-owned records.
4. The API executes business operations against OtyaPoint D1 only.
5. Durable events are emitted after a successful committed transaction; queue consumers are idempotent and send poison messages to the OtyaPoint dead-letter queue.
6. Other products consume only explicitly published API responses or versioned events; no product queries another product's database directly.

## Security invariants

- Do not bind OtyaPoint production data into otya-core merely for convenience. The dedicated API should bind only the OtyaPoint D1 database and its OtyaPoint resources.
- No browser, Android APK, public website or Git repository may contain service tokens, HMAC signing secrets, provider credentials or backup credentials.
- Do not trust a client-supplied role, actor ID, ledger type, provider success status or approval status.
- Every privileged write records the authenticated actor, action, entity, reason where relevant, request ID and timestamp.
- Idempotency keys are mandatory for retryable financial operations.
- Cash/retail posting must be atomic across sale, sale lines, stock movement, ledger and audit writes.
- Agency transactions must remain pending/unknown until the provider's authenticated response or status inquiry confirms the outcome.
- Retail and agency ledgers remain separate and reconcile independently.
- Next may propose or request high-impact actions, but sensitive operations require the same server-side permission checks and explicit approval as the staff UI.
- No direct database access from the UI and no cross-product SQL joins.

## Event envelope

Version 1 events should include:

- eventId: globally unique event ID
- eventType: namespaced string, e.g. otyapoint.retail.sale.completed.v1
- occurredAt: UTC ISO-8601 timestamp
- producer: service name
- tenantId, branchId: scope identifiers where applicable
- actorSubject: stable server-verified identity subject or service actor
- entityType, entityId
- correlationId, idempotencyKey
- schemaVersion
- data: minimal non-secret payload; never include access tokens, national ID numbers, full payment credentials or unnecessary personal data

Events are notifications, not a second ledger. Consumers must retrieve authoritative details from the owning API and must not treat queue delivery alone as proof of a financial transaction.

## Rollout rule

The OtyaPoint API is a new, isolated service. Build and test on a feature branch and isolated database first. Production database schema application, secret configuration, provider activation, DNS changes and live transaction enablement are separate gated steps. A successful build or health endpoint does not mean payment services are ready.

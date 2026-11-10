# OtyaPoint production readiness

This document is a high-level release policy, not a record of private infrastructure. It intentionally excludes resource identifiers, account settings, service bindings, private endpoints, backup object paths and credential instructions.

## Current position

The backend contains product-scoped authorization and business-operation foundations. The customer dashboard is not yet certified against the replacement Otya account session and business API. The replacement business system has not yet been provisioned with an owner, products, staff or sales. Live financial-provider writes remain disabled.

## Required acceptance gates

### Account and staff security

- Otya account identity is verified server-side.
- Each account maps to an explicitly provisioned, active OtyaPoint staff membership.
- Roles and company/branch scope are loaded from trusted server-side records.
- Browser tokens are stored only in secure, HttpOnly cookies.
- CSRF/origin protections, refresh rotation, session revocation and logout are tested.
- Suspended staff, unknown roles, missing memberships and cross-company access are denied.

### Business operations

- Inventory, stock movements and cash sales use the product API as the only writer.
- Sale retries are idempotent and conflicting retries are rejected.
- Ledger entries balance and historical records are immutable.
- Audit events identify the actor and reason without storing credentials or OTPs.
- Empty, unavailable, unauthorized and conflict states are distinct in the UI.

### Recovery and operations

- A current backup is available and private.
- A restore has been rehearsed in an isolated environment.
- Monitoring covers service health, failed requests and recovery alerts.
- A tested rollback and post-release verification plan exists.

### Financial providers

- Each provider has its own approved contract and merchant onboarding.
- Credentials are server-only and scoped to the minimum required services.
- Callback signatures, idempotency, duplicate events, unknown outcomes and reversals are tested.
- Reconciliation must work before provider writes are activated.

No release is complete because a build is green or a restricted backend exists. Customer use and real-money operations require explicit review and post-release verification.

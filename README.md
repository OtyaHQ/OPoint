# OtyaPoint

**OtyaPoint** is the shop and business-operations product in the Otya ecosystem. It is designed to bring retail, inventory, staff operations, cash controls and future mobile-money agency workflows into one clear experience.

## Product scope

- Retail catalogue, stock and cash-sale operations.
- Staff access with company and role-based authorization.
- Shop cash, agency cash and provider float kept as separate financial records.
- Commission, transaction history and reconciliation foundations.
- Clear operational reporting and audited corrections.

OtyaPoint is a product name, not a statement that every listed capability is currently available. The customer-facing dashboard is not yet certified against the replacement backend. Do not use this repository as proof that a customer-facing API or live payment integration is active.

## Architecture principles

- Otya account identity is shared across the ecosystem; OtyaPoint controls its own business authorization.
- Shop and agency records remain isolated from other Otya products.
- Server-side authorization determines staff identity, role and business scope.
- Financial changes are idempotent, auditable and reconciled.
- Provider timeouts and unknown outcomes remain unresolved until trusted status is confirmed.
- Backups and private business files must remain private.
- Production deployments, migrations and payment activation require review, recovery evidence and explicit release approval.

## Domain portability

The OtyaPoint API is a private Worker and must not depend on the current public website hostname. Product IDs, tenant IDs, D1 records, staff IDs and service bindings remain stable when public domains change. See [Domain and service identity](docs/DOMAIN_AND_SERVICE_IDENTITY.md) before introducing a URL or hostname dependency.

## Current public readiness

- Backend foundations and automated checks are maintained in this repository.
- Dashboard-to-backend integration is not yet certified for daily operations.
- No first shop owner, product catalogue, staff membership or sale has been provisioned in the replacement business system.
- Mobile-money and bill-payment write operations are not approved for live money movement.
- InterSwitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money are separate integrations. Listing them does not imply approval or live connectivity.

## Development

Use the repository's checked-in package scripts and tests for local development. Use synthetic data only. Do not point local tools at production resources or commit operational configuration.

## Public documentation and security

Public product and developer information belongs in the OtyaHub documentation surface. Keep private deployment details, infrastructure identifiers, recovery material, account data, provider credentials and administrative procedures out of public documentation and issue reports.

Report security vulnerabilities privately using [SECURITY.md](SECURITY.md).

---

**OtyaPoint · Otya**

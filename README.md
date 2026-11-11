# Opoint

**Opoint** is the business and financial-operations product in the Otya ecosystem. It brings retail, inventory, staff operations, cash controls and mobile-money agency workflows into one dependable experience.

## Product scope

- Retail catalogue, stock, POS and cash-sale operations.
- Company- and role-based staff access.
- Shop cash, agency cash and provider float kept as separate financial records.
- Financial ledger, commissions, transaction history and reconciliation.
- Controlled integrations for mobile money, bills, airtime and data.
- Operational notifications, live updates and audit history.

The product name is **Opoint**. Existing internal identifiers and database object names are retained for compatibility until separately reviewed migrations are justified.

Opoint is not yet certified for live financial operations. The current API supports cash-only retail sales; provider payment initiation is disabled pending provider adapters, controls, sandbox validation and production approvals. Do not use this repository as proof that live mobile-money or bill-payment writes are active.

## Architecture

- Cloudflare Workers provide Opoint's business API and server-side authorization.
- Opoint owns its isolated Cloudflare D1 business database and private business data.
- Cloudflare Queues and Durable Objects are used where reliable background processing and real-time coordination are required.
- A dedicated Opoint Firebase project will provide FCM, App Check, Crashlytics and mobile telemetry. Firebase is not the financial system of record.
- Otya identity can be shared, but Opoint independently enforces company membership, branch scope and business roles.
- Opoint business records remain isolated from all other Otya products, including Omy Play.

## Current public readiness

- Backend foundations and automated checks are maintained in this repository.
- The dashboard-to-backend integration is not yet certified for daily operations.
- No first shop owner, product catalogue, staff membership or sale has been provisioned in the replacement business system.
- Agency transaction creation is disabled. The current Quickteller capability is a sandbox authentication check, not payment initiation.
- Interswitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money are separate integrations. Listing them does not imply approval or live connectivity.
- The Flutter Android client is a separate build workstream and is not yet certified.

See [Opoint backend foundation](docs/OPOINT_BACKEND_FOUNDATION.md) for the observed system baseline, financial safety requirements and implementation sequence.

## Development

Use the repository's checked-in package scripts and tests for local development. Use synthetic data only. Do not point local tools at production resources or commit operational configuration.

Production deployments, remote database migrations and live payment activation require successful release gates, recovery evidence and an explicit release decision.

## Documentation and security

Public product and developer information belongs in the OtyaHub documentation surface. Keep private deployment details, infrastructure identifiers, recovery material, account data, provider credentials and administrative procedures out of public documentation and issue reports.

Report security vulnerabilities privately using [SECURITY.md](SECURITY.md).

---

**Opoint · Otya**

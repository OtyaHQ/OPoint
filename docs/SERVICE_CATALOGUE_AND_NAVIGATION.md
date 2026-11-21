# OtyaPoint service catalogue and navigation

## Product direction

OtyaPoint should make a broad range of business and customer services easy to discover through a clear service landing page, searchable categories, provider/biller selection, service-specific forms, validation before submission, and a transaction history/status view. The interface, branding, copy and workflows must be original to OtyaPoint.

## Initial operating scope

The first internal release is for OtyaPoint's own shop and authorised Mobile Money agency operations:

- Retail catalogue, POS, inventory, stock receiving and retail cash/receipt controls.
- Mobile Money agent cash-in/cash-out records, separate agency cash drawer, provider float and commission reconciliation.
- Separate worker assignments for Retail and Mobile Money, scoped by branch and duty. Access to one work area must not imply access to the other.
- Bills, airtime, data and other provider-backed services remain unavailable until a specific approved provider contract, sandbox verification, production credentials and compliance sign-off exist.

OtyaPoint is an internal business-operations tool, not a public payment processor or a multi-tenant SaaS offer. A locally recorded transaction is not proof that a provider executed or settled a payment.

## Proposed service hub

### 1. Money and agency
- Mobile money cash-in and cash-out
- Agent float / wallet balance view
- Supported wallet-to-wallet or transfer services only where an approved provider supports them
- Transaction lookup, reversal/request follow-up, and receipt history

### 2. Airtime and data
- Airtime top-up for self or another phone number
- Data bundles
- Provider/network selection from a maintained, provider-sourced catalogue

### 3. Bills and subscriptions
- Electricity and water
- TV subscriptions
- Internet and telecom bills
- School and institutional payments
- Government and tax payments
- Insurance, transport, and other billers only when available through a contracted provider

### 4. Retail
- Product catalogue, barcode/manual search, variants, cart and sale receipts
- Stock receiving, adjustments, returns and low-stock alerts
- Retail-only tax invoice metadata and EFRIS workflow where applicable

### 5. Service discovery and transaction records
- Search by service, provider, category or customer reference
- Category tiles with a clear description and availability state
- A detail form tailored to the chosen service
- A review step showing amount, charges (only if confirmed), recipient/reference and total
- A pending/success/failed/unknown status screen backed by the provider response and transaction query
- Receipt and transaction history, with support/reversal request where supported

## Uganda-first constraints

- This catalogue is a product plan, not a claim that every service is available in Uganda or through OtyaPoint today.
- Never display a provider, tariff, commission, biller, payment method or transaction limit as live until it is sourced from an approved integration/configuration.
- Provider adapters must expose supported services and required fields from verified provider contracts rather than hard-coded assumptions.
- For mobile-money or bill-pay transactions, persist an idempotency key, internal reference, provider reference when returned, request/response status, timestamps and reconciliation metadata. A locally created draft is not provider success.
- Do not collect customer PINs, OTPs, card security codes or other secrets in OtyaPoint forms.
- Keep retail sales and agency/provider transaction accounting separate, including receipts, commissions, cash movements and reconciliation.
- Any actual payment initiation or payment-system operation must be reviewed against the provider agreement and Uganda's regulatory requirements before enabling production.
- Populate the catalogue with Uganda-relevant providers and services only after availability and commercial authorization are confirmed. Never import unsupported providers, foreign currencies or unverified fees.

## Suggested information architecture

- **Home** — real totals only, separate retail and agency summaries, alerts and reconciliation status.
- **Services** — searchable category grid and provider-backed catalogue.
- **Agency desk** — cash-in/out and approved provider workflows.
- **Retail POS** — scan/search, cart, payment method, sale confirmation and retail receipt.
- **Inventory** — products, variants, stock movements and alerts.
- **Transactions** — filters by service, provider, status, date and internal/provider reference.
- **Reconciliation** — separate retail cash/stock checks and agency float/provider statements.
- **Reports** — permission-controlled retail, agency, commissions and audit exports.
- **Team & access** — roles, approvals and audit history.
- **Settings** — business profile, outlets, provider configuration, notifications and compliance settings.

## Delivery sequence

1. Build the service catalogue UI with clearly marked unavailable/unconnected services.
2. Add database-backed service/provider configuration and permission checks.
3. Add draft/review screens and idempotent transaction records without sending money.
4. Integrate one approved sandbox provider end-to-end, including transaction-status query and failure recovery.
5. Verify reconciliation, access controls, audit events and automated tests.
6. Enable a live provider only after explicit business approval, credentials are securely configured, and compliance/provider checks are complete.

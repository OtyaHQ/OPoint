# OtyaPoint — public deployment and product status

**Last reviewed:** 2026-11-10  
**Audience:** customers, developers and integration partners

This page is a public product-status summary, not an infrastructure inventory. It intentionally omits account identifiers, database and bucket names, service bindings, private routes, backup locations, recovery hashes, credential metadata and administrative procedures.

## Current product status

- **Product:** OtyaPoint is the retail and business-operations experience in the Otya family.
- **Backend:** server-side foundations exist, but a restricted backend deployment does not mean the public dashboard is connected.
- **Dashboard:** end-to-end authentication and business-data connectivity are not yet certified for daily operations.
- **Business data:** the replacement business system has not yet been provisioned with the first owner, products, staff or sales.
- **Retail:** the source includes inventory, stock and cash-sale foundations. Customer-facing use remains gated on the verified account and staff-session flow.
- **Agency:** InterSwitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money are separate provider integrations. Their presence in source code does not imply that they are approved or live.
- **Money movement:** live provider transactions, payouts and bill-payment writes remain disabled pending partner approval, callback verification, idempotency, reconciliation and financial-control tests.

## Integration principles

- Use Otya account identity with OtyaPoint-specific server-side authorization.
- Keep retail cash, agency cash, float, commissions and settlement records distinct.
- Never accept client-side role claims as authority.
- Never show a transaction as successful without trusted provider confirmation.
- Keep private business records, credentials, recovery material and operational telemetry out of public examples.

## Important note

A successful build, a restricted backend deployment or a schema migration is engineering evidence—not proof that a customer-facing product or financial integration is operational.

For public product and developer material, use the OtyaHub documentation surface. Private infrastructure and recovery information belongs in controlled Otya operations records.

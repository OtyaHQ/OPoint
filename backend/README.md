# Opoint backend

The private company-operations backend for **Opoint**. It owns retail, inventory, workforce, cash-session, financial-ledger and mobile-money agency records for the Otya business. Opoint is a product identity, not a claim that the parent company is legally incorporated.

## Production runtime

| Component | Canonical identity |
|---|---|
| Product API Worker | `opoint` |
| Worker exposure | Private; no `workers.dev` hostname or public API route |
| D1 schema/database | `opoint-prod-db` |
| Shared identity | Otya ID through the production `otya-auth` service binding |
| Source repository | `OtyaHQ/OPoint` |

The production database `opoint-prod-db` has the ten current forward migrations, including provider-float integrity guards. Company, branch, staff, stock, sale, journal, payment-intent and agency-operation records remain empty until the real owner completes onboarding and enters genuine business information. No sample company, fake staff, imaginary float, sales or provider transactions are inserted.

## Implemented capabilities

- Company and branch registration, products, suppliers, inventory and stock movements.
- Retail cash sales, receipts, cash sessions and branch-scoped operational access.
- Integer whole-shilling UGX amounts and balanced double-entry ledger invariants.
- Cash drawer and provider-float separation, provider outlet relationships and operator access.
- Staff memberships, work assignments and one-use invitations.
- Provider-message parsing as candidate evidence only; provider status stays UNKNOWN until independently verified.
- Provider execution, payment execution and AI remain disabled.

## Identity and permissions

Otya ID authenticates the person. Opoint resolves the authenticated identity to an active company membership and enforces role, branch and work-area scope on the server. Browser-supplied roles and employee identifiers are not authoritative. No duplicate Opoint identity database is created.

## Provider boundaries

Quickteller Business and InterSwitch Marketplace Routing are separate products. Airtel Money and MTN MoMo are distinct operator integrations. This backend does not mark a transaction successful from an SMS, notification or timeout. A pending/unknown outcome requires trusted provider status or reconciliation.

Live payment/provider execution remains disabled until production credentials, provider contracts, webhook verification, idempotency, reconciliation and legal/operational approval are completed.

## Verification

```sh
npm --prefix backend run check
npm --prefix backend test
npm --prefix backend run verify:schema
```

The private Worker can be deployed without exposing a public endpoint. Opoint's company onboarding and browser session bridge must pass their acceptance checks before the Core gateway exposes it to the owner dashboard.

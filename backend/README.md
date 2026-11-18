# OtyaPoint backend

OtyaPoint is private company software for Otya's own retail and mobile-money agency operations. This repository's product backend is the authoritative Worker and D1 source; legacy Cloudflare API code is retained for reviewed compatibility until a separately approved retirement.

## Runtime boundary

- Product API: Cloudflare Worker `opoint-api-staging` for isolated staging.
- Data: product-owned D1 and private R2; no cross-product business records.
- Identity: Otya ID service through a server-side service binding.
- AI, payment execution and provider execution remain disabled in staging.
- Amounts are whole-shilling UGX integers; ledger and provider evidence have separate integrity rules.

## Main capabilities in code

- Company and branch onboarding.
- Product catalogue and operational read views.
- Branch-scoped work assignments with separate **RETAIL** and **MOBILE_MONEY** work areas.
- Independent duty roles for workers assigned to both areas.
- Cash-account work-area classification under owner/admin authorization.
- Idempotent journal and sales primitives, stock integrity guards, audit records and sandbox provider adapters.

## Workforce and provider access

Forward migrations `0005_enterprise_automation`, `0006_message_capture_and_receipts` and `0007_provider_operator_access` model employee profiles, branch assignments, company assets/SIM inventory, provider relationships and outlet accounts, provider balance observations, explicitly shared message evidence, statement imports and immutable receipt history.

The Worker exposes company-scoped staff and branch read endpoints, branch-scoped Retail/Mobile Money work assignments, provider relationship/outlet/operator management endpoints, and a signed-in employee endpoint for their own currently approved provider operator assignments. Owner/admin checks, branch scope, provider approval, completed training and optional company-SIM network/assignment checks are enforced server-side. Suspending or revoking a Mobile Money work assignment automatically suspends or revokes its linked provider operator profile and outlet permission grant. Revoked assignments are terminal.

The workforce directory returns limited employment metadata only. It does not expose raw KYC documents or identity numbers. Provider lines are modeled as separate company SIM assets, not employee KYC/login phone numbers. InterSwitch Marketplace Routing and Quickteller Business remain distinct bill-payment/merchant integrations, not Airtel/MTN mobile-money operator accounts.

The API layer is implemented on the review branch; the complete browser workforce screens, Otya ID server-side session bridge, generic trusted-device proof and end-to-end acceptance remain follow-on work. Message parsing is candidate extraction for human review only and returns `providerStatus: UNKNOWN`. These capabilities do not request Android SMS inbox permissions, read notifications, or initiate payments. See [WORKFORCE_ACCESS_MODEL.md](../docs/WORKFORCE_ACCESS_MODEL.md).

## Local verification

```sh
npm --prefix backend run check
npm --prefix backend test
npm --prefix backend run verify:schema
```

## Release rules

- Staging deploy is manual and requires `DEPLOY-STAGING`, a dedicated staging Cloudflare token and a deployed isolated Otya ID staging Worker.
- Production deployment is a separate manual owner-authorized workflow.
- Never apply the schema-only bootstrap to an existing D1 database; use the forward migrations.
- Do not enable real-money provider writes until provider contracts, legal/compliance requirements, callbacks, idempotency, reconciliation, recovery and owner release approval have passed.
- Do not copy user records, staff permissions, float balances or historical transactions automatically during migration.

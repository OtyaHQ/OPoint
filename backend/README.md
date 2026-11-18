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

## Schema-only enterprise foundation

Forward migrations `0005_enterprise_automation` and `0006_message_capture_and_receipts` model employee profiles, company assets/SIM inventory, provider relationships and outlet accounts, provider balance observations, explicitly shared message evidence, statement imports and issued receipt history.

Migrations 0005 and 0006 establish the enterprise schema. The provider relationship, outlet-account and operator-approval API is implemented as a separate reviewable Worker layer and uses those canonical tables; it does not create duplicate employee/provider entities. Provider operator approval requires the exact active branch Mobile Money assignment, active company SIM assignment when used, provider approval reference and completed training. Message parsing is candidate extraction for human review only and returns `providerStatus: UNKNOWN`. These capabilities do not request Android SMS inbox permissions, read notifications, or initiate payments.

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

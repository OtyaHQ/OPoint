# OtyaPoint backend

OtyaPoint is private company software for Otya's own retail and mobile-money agency operations. This repository's product backend is the authoritative Worker and D1 source; legacy Cloudflare API code is retained for reviewed compatibility until a separately approved retirement.

## Runtime boundary

- Production API: Cloudflare Worker `otyapoint-api`, private behind the Otya Core same-origin gateway.
- Data: product-owned D1 and private R2; no cross-product business records.
- Identity: Otya ID service through a server-side service binding.
- AI, payment execution and provider execution remain explicitly disabled in production until their individual release gates pass.
- Amounts are whole-shilling UGX integers; ledger and provider evidence have separate integrity rules.

## Main capabilities in code

- Company and branch onboarding.
- Product catalogue, opening inventory, branch stock views and cash-controlled retail sales.
- Cash session opening, count submission and supervisor/owner review with discrepancy handling.
- Atomic cash sales: receipt, cash payment intent, stock movement, cash-session expected balance and balanced double-entry journal are committed together.
- Branch-scoped work assignments with separate **RETAIL** and **MOBILE_MONEY** work areas.
- Independent duty roles for workers assigned to both areas.
- Cash-account work-area classification under owner/admin authorization.
- Idempotent sales and opening-stock records, stock integrity guards, audited cash sessions and balanced journal posting.
- Retail sales are cash-only for now; mobile-money and bill-payment provider execution remains disabled.

## Workforce and provider access

Forward migrations `0005_enterprise_automation`, `0006_message_capture_and_receipts`, `0007_provider_operator_access` and `0008_staff_invitations` model employee profiles, branch assignments, company assets/SIM inventory, provider relationships and outlet accounts, provider balance observations, explicitly shared message evidence, statement imports and immutable receipt history.

The Worker exposes company-scoped staff and branch read endpoints, branch-scoped Retail/Mobile Money work assignments, provider relationship/outlet/operator management endpoints, and a signed-in employee endpoint for their own currently approved provider operator assignments. Owner/admin checks, branch scope, provider approval, completed training and optional company-SIM network/assignment checks are enforced server-side. Suspending or revoking a Mobile Money work assignment automatically suspends or revokes its linked provider operator profile and outlet permission grant. Revoked assignments are terminal.

The workforce directory returns limited employment metadata only. It does not expose raw KYC documents or identity numbers. One-use staff invitations require a verified Otya ID email, store only a token digest, and create a pending membership on redemption; only an Owner/Admin may activate that membership. Owner transfers are excluded from normal invites, and membership suspension/revocation cascades to work assignments and provider permissions. Provider lines are modeled as separate company SIM assets, not employee KYC/login phone numbers. InterSwitch Marketplace Routing and Quickteller Business remain distinct bill-payment/merchant integrations, not Airtel/MTN mobile-money operator accounts.

The API layer is implemented on the review branch; complete browser workforce screens, the Otya ID server-side browser-session bridge, generic trusted-device proof and end-to-end browser acceptance remain follow-on work. Invitation delivery remains disabled in staging until a dedicated staging-only service token and matching Otya Auth staging route are available. Message parsing is candidate extraction for human review only and returns `providerStatus: UNKNOWN`. These capabilities do not request Android SMS inbox permissions, read notifications, or initiate payments. See [WORKFORCE_ACCESS_MODEL.md](../docs/WORKFORCE_ACCESS_MODEL.md).

## Production runtime

- Production Worker config: `wrangler.opoint-production.toml`.
- Production D1: `otyapoint-prod-db`, initialized from the schema-only baseline and forward migrations through `0009_cash_session_lifecycle`.
- Identity: the existing single Otya Auth/ID Worker (`otya-auth`) through a private service binding. No duplicate identity database is created.
- The Worker has no `workers.dev` hostname or public custom domain; the Core gateway is its only browser entry point.
- The legacy `cloudflare-api/` implementation is compatibility/reference code and is not the canonical production runtime.

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

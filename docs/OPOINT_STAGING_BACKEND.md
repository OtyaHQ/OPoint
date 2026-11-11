# Opoint staging backend

This is the new product-owned backend package. It is deliberately separate from the legacy API in cloudflare-api/ and its old database binding.

## Resource boundary

- Worker: opoint-api-staging
- D1: opoint-staging-db
- Identity: the Otya ID service through a server-side service binding
- Payments/provider writes: disabled
- Firebase: mobile attestation/notifications only; no financial records are stored there

## Included API surface

- GET /health — required D1 schema, migration and financial-guard readiness.
- GET /v1/capabilities — explicitly reports financial/provider execution as disabled.
- GET /v1/me — verified Otya ID and active Opoint company memberships.
- POST /v1/companies — idempotent company onboarding; creates an owner, main branch, inventory location, default ledger accounts and cash drawer.
- GET/POST /v1/products — company-authorized product catalogue.
- GET /v1/overview — company-scoped read-only business summary.
- GET /v1/integrations — provider status only; no credentials.

All protected routes require a verified Otya ID bearer token and an active Opoint membership. Company identifiers supplied by the client are treated only as selectors and are validated against the token's membership. No client-supplied role or user ID is trusted.

## Explicitly not enabled

Sales posting, journal posting, provider cash-in/out, bill payments, airtime/data, refunds/reversals, EFRIS submission and webhook processing are not exposed in this first staging slice. They require dedicated atomic financial workflows and provider-specific signature, idempotency, callback, reconciliation and compliance tests. No live provider credential is bound to this Worker.

## Test and deploy

Run locally with Node 22:

    npm --prefix backend run check
    npm --prefix backend test

Deploy only to this Worker using Wrangler and this config after the CI check:

    npx wrangler deploy --config wrangler.opoint-staging.toml

Do not use the legacy wrangler.toml for this new backend. It still points to the legacy Worker and database and is retained only as a compatibility reference until migration and cutover are reviewed.

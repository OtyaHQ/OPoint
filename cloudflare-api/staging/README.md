# Opoint staging API

Version-controlled source for the isolated `opoint-api-staging` Worker.

## Runtime boundary

- Worker: `opoint-api-staging`
- D1: `opoint-staging-db`
- Product: `OPOINT`; environment: `staging`
- `PAYMENT_EXECUTION_ENABLED=false`, `PROVIDER_EXECUTION_ENABLED=false`, `AI_ENABLED=false`
- Identity currently uses a service binding to `otya-auth`. Replace this with isolated `otya-id-staging` before onboarding external testers.

The API covers companies, staff identity, products, inventory, sales, cash, purchasing, expenses, ledger entries, agency operations, payment intents, biller catalog and reconciliation. Provider execution/live money movement is disabled. A payment intent does not prove a provider transaction executed.

## Files

- `src/index.mjs`: exact single-module source deployed to staging on 2026-11-11.
- `snapshots/2026-11-11-current.sql`: schema-only snapshot from staging D1 plus recorded migration history; no business rows.
- `wrangler.toml`: staging bindings only.
- `tests/contract.test.mjs`: pure helper contracts.

From repository root:

```sh
node --test cloudflare-api/staging/tests/*.test.mjs
```

## Financial safety

Integer UGX amounts; append-oriented ledger with database guards; unknown provider outcomes remain unresolved until reconciliation. Quickteller Business and InterSwitch Marketplace Routing are separate adapters. Production bindings, secrets, data migration and live payment activation are separate release gates.

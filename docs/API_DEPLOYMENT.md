# OtyaPoint API private deployment

The production D1 database is prepared through migration `0009_agency_cash_float_book.sql`. The dedicated API Worker is still a separate deployment from the database and the dashboard.

## Release workflow

The repository now includes `.github/workflows/deploy-api.yml`. It is a **manual-only** GitHub Actions workflow. Start it from the protected `main` branch in **Actions → Deploy OtyaPoint private API**. The validation job runs the D1 schema checks, API authorization and agency tests, Quickteller tests, local-runtime checks, TypeScript, lint, dashboard build and a Wrangler dry run. The deploy job runs only when the workflow input is explicitly set to `DEPLOY`.

The deploy job targets the `production` GitHub Environment. Configure that environment with required reviewers (at least one owner-controlled reviewer), deployment branch restriction to `main`, and no unnecessary bypass permissions. A workflow input is not a substitute for environment protection. The job fails closed when its account variable or API-token secret is missing.

The workflow deploys only the private Worker from the checked-in `wrangler.toml`. It does not apply D1 migrations, create DNS/custom routes, enable the `workers.dev` subdomain, enable payment-provider writes, or publish the dashboard. Do not run it from an unreviewed branch.

The workflow deploys `otyapoint-api` using the root `wrangler.toml`. That config keeps `workers_dev = false`, exposes no public route, and binds the OtyaPoint D1 database, the shared `otya-auth` service, the one-time owner/invitation secrets, and the four Quickteller Secrets Store entries scoped only to this Worker. It does not apply remote migrations, alter DNS, enable a public endpoint, or enable payment-provider writes. The Quickteller bindings support an owner-only sandbox OAuth diagnostic; they do not enable checkout or money movement.

## Required GitHub Actions credentials

Configure these in **OtyaPoint → Settings → Secrets and variables → Actions** (prefer the `production` environment for the three Worker secrets):

- Variable `CLOUDFLARE_ACCOUNT_ID` (or repository/environment secret with the same name).
- Secret `CLOUDFLARE_API_TOKEN`, narrowly scoped to this Cloudflare account with Workers Scripts Write and the minimum D1 read permission required to resolve the configured D1 binding.

Both secret values are stored centrally in Cloudflare Secrets Store and are bound to the exact Workers that need them. Otya Auth and OtyaPoint read the service token through a purpose-specific binding; OtyaPoint reads the one-time bootstrap secret through its own binding. The values are write-only in the Secrets Store API and are never copied into GitHub, source code, Wrangler variables or chat. The deployment API token must have Account Secrets Store Edit permission so Wrangler can resolve/deploy these bindings.

## Verified live Worker baseline (2026-11-10)

Cloudflare account inspection confirmed an existing published `otyapoint-api` deployment, four Quickteller Secrets Store bindings, the D1 binding and the private Otya Auth service binding. The Worker has `workers_dev = false`, its `workers.dev` subdomain is disabled, and no custom route was attached at inspection time. A published private Worker is not an externally reachable dashboard or public API.

## After the Worker deploys

The Worker remains private. The next release unit is to deploy the OtyaPoint dashboard in a verified Cloudflare runtime, bind it to `otyapoint-api` and `otya-auth`, and implement a same-origin session BFF with secure HttpOnly cookies, CSRF/origin checks, refresh rotation and logout revocation. Do not expose the API directly to browsers or put bearer tokens in local storage.

The existing dashboard still has legacy Supabase and Prisma paths. Keep those dependencies and routes intact until the replacement session and API integration has passed end-to-end browser tests and business data has been reconciled.

Provider execution, EFRIS submissions and real-money actions remain disabled. They need their own approved credentials, provider status/callback verification, idempotency, settlement and reconciliation release gates.

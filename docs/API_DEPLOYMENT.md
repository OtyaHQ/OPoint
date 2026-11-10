# OtyaPoint API private deployment

The production D1 database is prepared through migration `0009_agency_cash_float_book.sql`. The dedicated API Worker is still a separate deployment from the database and the dashboard.

## Release workflow

The repository now includes `.github/workflows/deploy-api.yml`. It is a **manual-only** GitHub Actions workflow. Start it from the protected `main` branch in **Actions → Deploy OtyaPoint private API**. The validation job runs the D1 schema checks, API authorization and agency tests, Quickteller tests, local-runtime checks, TypeScript, lint, dashboard build and a Wrangler dry run. The deploy job runs only when the workflow input is explicitly set to `DEPLOY`.

The deploy job targets the `production` GitHub Environment. Configure that environment with required reviewers (at least one owner-controlled reviewer), deployment branch restriction to `main`, and no unnecessary bypass permissions. A workflow input is not a substitute for environment protection. The workflow uses the verified Otya Cloudflare account ID as its default; an environment-level `CLOUDFLARE_ACCOUNT_ID` variable may override it when deliberately targeting another account. The `CLOUDFLARE_API_TOKEN` secret remains required. Before Wrangler runs, the workflow checks that the token is active without printing or exposing its value.

The workflow deploys only the private Worker from the checked-in `wrangler.toml`. It does not apply D1 migrations, create DNS/custom routes, enable the `workers.dev` subdomain, enable payment-provider writes, or publish the dashboard. Do not run it from an unreviewed branch.

The root `wrangler.toml` keeps `workers_dev = false`, exposes no public route, and binds the OtyaPoint D1 database, the shared `otya-auth` service, the one-time owner/invitation secrets, and the four Quickteller Secrets Store entries scoped only to this Worker. It does not apply remote migrations, alter DNS, enable a public endpoint, or enable payment-provider writes. The Quickteller bindings support an owner-only sandbox OAuth diagnostic; they do not enable checkout or money movement.

## Required GitHub Actions credentials

Configure this as an **environment-level secret** under **OtyaPoint → Settings → Environments → production**:

- Secret `CLOUDFLARE_API_TOKEN`: a dedicated, narrowly scoped Cloudflare API token for this repository's private Worker deployment. Grant only the permissions required by Wrangler: Workers Scripts Write, D1 Read for the configured binding, and Account Secrets Store Edit so Wrangler can resolve the configured Secrets Store bindings.

The Otya Cloudflare account ID is already the workflow default and is not a secret. An environment-level `CLOUDFLARE_ACCOUNT_ID` variable is optional and overrides that default only when intentionally deploying to another account.

Do not reuse Quickteller credentials as a deployment token. Do not paste the Cloudflare API token into chat, source code, build variables or logs. The separate `OTYAPOINT_BOOTSTRAP_SECRET`, `OTYAPOINT_INVITE_SERVICE_TOKEN` and Quickteller values remain in Cloudflare Secrets Store and are bound only to the Workers that need them; they are not GitHub Actions deployment credentials.

## Verified live Worker baseline (2026-11-10)

Cloudflare account inspection confirmed an existing published `otyapoint-api` deployment, four Quickteller Secrets Store bindings, the D1 binding and the private Otya Auth service binding. The Worker has `workers_dev = false`, its `workers.dev` subdomain is disabled, and no custom route was attached at inspection time. A published private Worker is not an externally reachable dashboard or public API.

## After the Worker deploys

The Worker remains private. The next release unit is to deploy the OtyaPoint dashboard in a verified Cloudflare runtime, bind it to `otyapoint-api` and `otya-auth`, and implement a same-origin session BFF with secure HttpOnly cookies, CSRF/origin checks, refresh rotation and logout revocation. Do not expose the API directly to browsers or put bearer tokens in local storage.

The existing dashboard still has legacy Supabase and Prisma paths. Keep those dependencies and routes intact until the replacement session and API integration has passed end-to-end browser tests and business data has been reconciled.

Provider execution, EFRIS submissions and real-money actions remain disabled. They need their own approved credentials, provider status/callback verification, idempotency, settlement and reconciliation release gates.

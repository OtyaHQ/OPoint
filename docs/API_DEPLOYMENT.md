# OtyaPoint API private deployment

The production D1 database is prepared through migration `0009_agency_cash_float_book.sql`. The dedicated API Worker is still a separate deployment from the database and the dashboard.

## Release workflow

Use `.github/workflows/deploy-api.yml` from the protected `main` branch. It runs the Worker, local runtime, security-boundary, agency, dashboard build, lint and Wrangler dry-run checks before deployment. The deployment job requires the exact input `DEPLOY` and the `production` GitHub Environment.

The workflow deploys `otyapoint-api` using the root `wrangler.toml`. That config keeps `workers_dev = false`, exposes no public route, and binds only the OtyaPoint D1 database and the shared `otya-auth` service. It does not apply remote migrations, alter DNS, enable a public endpoint, or enable payment-provider writes.

## Required GitHub Actions credentials

Configure these in **OtyaPoint → Settings → Secrets and variables → Actions** (prefer the `production` environment for the three Worker secrets):

- Variable `CLOUDFLARE_ACCOUNT_ID` (or repository/environment secret with the same name).
- Secret `CLOUDFLARE_API_TOKEN`, narrowly scoped to this Cloudflare account with Workers Scripts Write and the minimum D1 read permission required to resolve the configured D1 binding.

Both secret values are stored centrally in Cloudflare Secrets Store and are bound to the exact Workers that need them. Otya Auth and OtyaPoint read the service token through a purpose-specific binding; OtyaPoint reads the one-time bootstrap secret through its own binding. The values are write-only in the Secrets Store API and are never copied into GitHub, source code, Wrangler variables or chat. The deployment API token must have Account Secrets Store Edit permission so Wrangler can resolve/deploy these bindings.

## After the Worker deploys

The Worker remains private. The next release unit is to deploy the OtyaPoint dashboard in a verified Cloudflare runtime, bind it to `otyapoint-api` and `otya-auth`, and implement a same-origin session BFF with secure HttpOnly cookies, CSRF/origin checks, refresh rotation and logout revocation. Do not expose the API directly to browsers or put bearer tokens in local storage.

The existing dashboard still has legacy Supabase and Prisma paths. Keep those dependencies and routes intact until the replacement session and API integration has passed end-to-end browser tests and business data has been reconciled.

Provider execution, EFRIS submissions and real-money actions remain disabled. They need their own approved credentials, provider status/callback verification, idempotency, settlement and reconciliation release gates.

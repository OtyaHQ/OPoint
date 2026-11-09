# OtyaPoint API private deployment

The production D1 database is prepared through migration `0009_agency_cash_float_book.sql`. The dedicated API Worker is still a separate deployment from the database and the dashboard.

## Release workflow

Use `.github/workflows/deploy-api.yml` from the protected `main` branch. It runs the Worker, local runtime, security-boundary, agency, dashboard build, lint and Wrangler dry-run checks before deployment. The deployment job requires the exact input `DEPLOY` and the `production` GitHub Environment.

The workflow deploys `otyapoint-api` using the root `wrangler.toml`. That config keeps `workers_dev = false`, exposes no public route, and binds only the OtyaPoint D1 database and the shared `otya-auth` service. It does not apply remote migrations, alter DNS, enable a public endpoint, or enable payment-provider writes.

## Required GitHub Actions credentials

Configure these in **OtyaPoint → Settings → Secrets and variables → Actions** (prefer the `production` environment for the three Worker secrets):

- Variable `CLOUDFLARE_ACCOUNT_ID` (or repository/environment secret with the same name).
- Secret `CLOUDFLARE_API_TOKEN`, narrowly scoped to this Cloudflare account with Workers Scripts Write and the minimum D1 read permission required to resolve the configured D1 binding.
- Secret `OTYAPOINT_BOOTSTRAP_SECRET`: a fresh random value of at least 32 characters. Never store it in Git or paste it into chat.
- Secret `OTYAPOINT_INVITE_SERVICE_TOKEN`: the same service-to-service token configured on Otya Auth for the OtyaPoint staff-invitation notification endpoint. Do not generate a different value on only one side.

The workflow refuses to deploy if the owner-bootstrap or shared notification secret is missing or too short. It transfers them to Cloudflare with Wrangler secret commands; it never logs their values.

## After the Worker deploys

The Worker remains private. The next release unit is to deploy the OtyaPoint dashboard in a verified Cloudflare runtime, bind it to `otyapoint-api` and `otya-auth`, and implement a same-origin session BFF with secure HttpOnly cookies, CSRF/origin checks, refresh rotation and logout revocation. Do not expose the API directly to browsers or put bearer tokens in local storage.

The existing dashboard still has legacy Supabase and Prisma paths. Keep those dependencies and routes intact until the replacement session and API integration has passed end-to-end browser tests and business data has been reconciled.

Provider execution, EFRIS submissions and real-money actions remain disabled. They need their own approved credentials, provider status/callback verification, idempotency, settlement and reconciliation release gates.

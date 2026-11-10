# OtyaPoint Cloudflare-only dashboard and Otya Auth migration runbook

Last reviewed: 2026-11-10

## Goal

Finish the existing OtyaPoint application as one connected system: GitHub source, Cloudflare dashboard/runtime and D1 business data, Otya Auth as the shared identity authority, and Resend for transactional email. This runbook is an implementation gate, not a claim that the migration or deployment has already happened.

## Verified starting point

- The Cloudflare API entry point is `cloudflare-api/src/index.ts`; its Wrangler configuration is `wrangler.toml`.
- The Worker verifies a bearer token by calling `GET https://auth/auth/verify` through the `AUTH` service binding. It requires `{ ok: true, user_id: <non-empty string> }`, then resolves the identity against `omni_staff_memberships.identity_subject`.
- `GET /api/me`, `GET /api/products`, `GET /api/summary`, `POST /api/products`, `POST /api/stock-adjustments`, and `POST /api/sales` are implemented in the Worker. Sales remain cash-only; non-cash methods are disabled.
- Regression coverage for missing tokens, failed identity verification, Auth service failure, inactive staff, unknown roles, and successful identity-to-staff mapping was merged in PR #82.
- The dashboard login action in `app/login/actions.ts` still calls `createSupabaseServerClient()`. Other active Supabase SSR, Supabase admin, Prisma, middleware, staff invitation, and data-access paths remain. The dashboard is not yet fully connected to the Cloudflare API.
- PR #85 removed the legacy `app/api/bridge/products/route.ts` local HS256-token flow and made the route fail closed with a non-cacheable HTTP 503 until dashboard sessions use Otya Auth and the verified identity is mapped to an active OtyaPoint staff membership. The bridge is not a production integration.
- A direct read-only Cloudflare account inventory on 2026-11-10 confirms `otyapoint-api` exists and has a published deployment receiving 100% of Worker traffic (latest observed deployment: `2026-11-10T05:48:48Z`). The Worker remains private: `workers_dev = false`, with no public route or custom domain attached. Its live bindings include the dedicated `otyapoint-db` D1 database, the `otya-auth` service, and account-level owner-bootstrap and staff-invitation secrets. This is a private backend deployment, not a customer-facing launch; it does not prove the dashboard is connected or that the API has passed end-to-end browser acceptance. The older 2026-10-30 inventory is historical and superseded by this inspection.
- The same 2026-11-10 read-only D1 inspection confirmed migrations `0001–0009` are recorded and all 13 expected OtyaPoint business tables currently contain zero rows. No owner membership, products, staff, sales, ledger entries or agency records have been provisioned. No production business records were written during this inspection.

## Target trust boundaries

1. **Otya Auth owns identity:** credentials, login, access-token issuance, refresh-token rotation/revocation, email verification, account recovery and account security.
2. **OtyaPoint owns business authorization:** a verified Otya Auth `user_id` must map to a provisioned, active `omni_staff_memberships.identity_subject`. Role and company/branch scopes are read from D1, never from client-provided claims.
3. **Cloudflare D1 owns business state:** product, stock, sales, ledger, agency and audit writes go through the OtyaPoint Worker. Do not introduce a second active writer or client-side privileged database credentials.
4. **The browser gets a secure session boundary:** access and refresh tokens must not be placed in localStorage, URLs, logs, analytics, or client-visible environment variables. Use Secure, HttpOnly, SameSite cookies with deliberate Path/Domain/expiry settings, CSRF protections for state-changing browser requests, and server-side refresh/logout handling. Cookie domain and hosting topology must be verified before implementation.
5. **Resend remains shared email transport:** Otya Auth owns identity/security messages; OtyaPoint business notifications must use approved server-side templates/recipients and avoid secrets or payment credentials in email.

## Required implementation phases

### Phase A — establish the actual dashboard runtime

- Identify the canonical production hostname and current runtime for the Next.js dashboard. Do not assume the API Worker is the dashboard host.
- Choose and test a Cloudflare-compatible Next.js deployment path using the existing repository and a preview environment. Keep the API Worker as a separately bounded service until routing and service bindings are verified.
- Bind Otya Auth using a Cloudflare service binding where the dashboard runtime supports it; otherwise use a narrowly scoped server-side endpoint with an explicitly designed trust contract. Never expose a privileged internal secret to browser code.
- Keep production routes and DNS unchanged until preview acceptance and explicit release approval.

### Phase B — implement login and browser sessions

- Replace the Supabase-backed `signInAction` with a server-side call to Otya Auth `POST /auth/login`, after validating the real request/response contract against the current Auth implementation.
- Use the returned access token only server-side; set the refresh token in an HttpOnly Secure cookie. Keep both out of HTML, browser storage and logs.
- Add server-side `/api/account-session` handlers for current-session lookup, refresh/rotation and logout/revocation. Clear cookies on invalid/expired/revoked sessions.
- Verify CSRF protection, origin checks, cookie scope, redirect allowlisting, refresh-token rotation races, and safe behavior during Auth outage.
- Never create a second user/identity database in OtyaPoint. Never mint an Otya Auth JWT locally.

### Phase C — staff provisioning and authorization

- Create an audited, owner-authorized staff provisioning path that maps a real Otya Auth user ID to an OtyaPoint company/branch and allowed role.
- Prevent self-assigned roles, client-supplied company IDs, duplicate active memberships where disallowed, and cross-company data access.
- Test suspended/deactivated staff, revoked sessions, unknown roles, branch restrictions, identity changes, and missing staff membership.
- Do not automatically grant staff access merely because an email address matches.

### Phase D — migrate dashboard data paths

- Replace Supabase-backed product reads and writes with the OtyaPoint Worker endpoints.
- Migrate inventory, sales, staff management, dashboard summary, reports, and other discovered data paths one feature at a time.
- Add request/response contract tests and UI-level tests for each migrated feature.
- Use idempotency keys for sale submissions and preserve the existing replay/conflict behavior.
- Keep the existing source database read-only for recovery/reference during migration. No dual writes.
- Only remove Supabase/Prisma packages, environment variables, middleware and code after repository-wide import/search checks, build, lint, route tests, and recovery checks prove there are no remaining active dependencies.

### Phase E — release and recovery gate

- Confirm schema migrations, target D1 ID, backup object, SHA-256, and restore test before any remote schema operation.
- Confirm all authentication, authorization, product, stock, sale, ledger, audit, and UI acceptance tests in a Cloudflare preview using synthetic data.
- Confirm no payment provider can execute live transactions; non-cash payment methods remain disabled until separately approved and provider-certified.
- Record the exact Worker version, route, bindings, rollback version, recovery snapshot and post-release smoke checks.
- Obtain explicit production release approval before changing secrets, DNS, routes, live Worker versions, remote D1 schema/data, or payment settings.

## Acceptance criteria

- Login, refresh, logout, verification and recovery use Otya Auth; there is no Supabase login fallback.
- Tokens cannot be read by browser JavaScript and are never logged.
- The OtyaPoint Worker only accepts tokens verified by Otya Auth; staff membership, role and company scope are resolved server-side.
- Every dashboard feature uses the Cloudflare API/D1 as its only active business writer.
- Automated tests cover authentication failure modes, staff provisioning, company/branch isolation, CRUD, stock invariants, sale idempotency, ledger balancing and error recovery.
- CI, build, lint, security checks and isolated preview smoke tests pass.
- No legacy resource is deleted, no live payment is enabled, and no production cutover occurs without a separate explicit approval.

## Explicitly not completed by this document

This runbook does not itself deploy the dashboard or API Worker, change DNS/secrets, migrate production data, apply remote migrations, remove dependencies, or activate payments. Those actions require verified implementation, tests and the release gate above.

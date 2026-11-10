# OtyaPoint Cloudflare-only dashboard and Otya Auth migration runbook

Last reviewed: 2026-11-10

## Goal

Finish the existing OtyaPoint application as one connected system: GitHub source, Cloudflare dashboard/runtime and D1 business data, Otya Auth as the shared identity authority, and Resend for transactional email. This runbook is an implementation gate, not a claim that the migration or deployment has already happened.

## Verified starting point

- The Cloudflare API entry point is `cloudflare-api/src/index.ts`; its Wrangler configuration is `wrangler.toml`.
- The API's current target trust boundary is Otya Auth for identity and local OtyaPoint D1 staff memberships for company/branch authorization. The Worker must resolve the authenticated Otya user against an active local membership; the browser must never supply its own role or company scope.
- The Cloudflare account now has a published `otyapoint-api` Worker deployment. It is intentionally private: `workers_dev = false`, and no public route or custom domain is attached. A deployed private Worker is not a public customer service and does not prove the dashboard is connected.
- Production `otyapoint-db` records migrations `0001–0009`. The 2026-11-10 inspection verified the 13 expected business tables and the current sale-idempotency, owner bootstrap, staff invitation, append-only history, and cash/float integrity objects. All 13 business tables were empty at that inspection; there was no owner membership, product, staff membership, sale, or agency transaction to migrate or display.
- The Worker source includes authenticated inventory and stock routes, cash-only idempotent retail sale posting, ledger/audit foundations, a one-time secret-gated first-owner bootstrap, owner-controlled staff invitations, and read-only agency summary routes. The agency-provider write route remains disabled.
- Quickteller Business is a separate sandbox adapter. A SOVEREIGN-only sandbox OAuth diagnostic is implemented, but requires an active, provisioned owner and has not been executed by an owner. It does not initiate payments or expose tokens. InterSwitch Marketplace Routing, Airtel Money, and MTN Mobile Money remain separate integrations; none is approved for live money movement.
- The dashboard is **not yet fully connected** to the private API. Its active legacy Prisma/PostgreSQL and Supabase authentication/data paths remain. The former local-HS256 inventory bridge was deliberately made fail-closed; it is not an approved production integration. The dashboard needs a server-side Otya Auth session bridge and a same-origin backend-for-frontend before business routes can be enabled for daily use.
- Keep all existing Supabase/Prisma data, compatibility code, remote databases, historical backups, and restore-verification databases intact until exports are reconciled, a single-writer cutover is tested, and rollback is independently verified. Do not infer that an empty table or an unused code path is safe to delete.

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

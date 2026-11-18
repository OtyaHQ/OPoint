# OtyaPoint web dashboard — authentication and Cloudflare migration

**Current finding (18 November 2026):** The existing Next.js management dashboard still uses Supabase Auth and Prisma for staff-facing authorization. Those imports are active and cannot be deleted safely yet. The canonical OtyaPoint Worker and workforce API are now checked into this repository on draft PR #152, but the browser session bridge and dashboard cutover are not complete.

## Confirmed current implementation

- `middleware.ts` creates a Supabase server client, calls `auth.getUser()`, and redirects unauthenticated requests to `/login`.
- `lib/auth.ts` uses Supabase Auth and then resolves staff profile/role through Prisma.
- `app/login/actions.ts` signs in with the legacy email/password flow.
- `lib/supabase/server.ts` manages Supabase auth cookies.
- `lib/supabase/admin.ts` and `app/management/staff/actions.ts` use the Supabase admin client for staff invitations.
- The root package still depends on `@supabase/ssr` and `@supabase/supabase-js`, and the dashboard package build is part of the current verification workflow.
- Root `wrangler.toml` still targets the legacy `cloudflare-api/src/index.ts` Worker. It is **not** a Next.js deployment configuration.
- The canonical OtyaPoint API is `backend/src/index.mjs`, with isolated staging config in `wrangler.opoint-staging.toml`. Draft PR #152 contains the new staff directory, branch/work-area, provider-operator, invitation and membership lifecycle APIs. Its backend CI, security baseline and full Verify OtyaPoint workflow passed at the recorded branch revision; the PR is not merged or deployed.
- The staging OtyaPoint Worker uses a service binding to the isolated Otya ID service. Invitation delivery remains fail-closed until a separate staging-only invitation service token and matching isolated Auth route are provisioned.

Removing Supabase or Prisma today would break the existing dashboard login, server-side authorization and invitation paths. Migrate those flows end-to-end before removing the legacy dependencies.

## Target architecture

1. **One identity authority:** Otya ID is the only login/session authority. OtyaPoint stores company membership, staff roles, branch assignments and work-area permissions in its canonical D1 database.
2. **Server-only browser sessions:** the dashboard BFF holds short-lived access tokens and rotating refresh tokens in secure, HttpOnly, SameSite cookies. Prefer host-only `__Host-` cookie names with `Path=/`, `Secure`, and no `Domain` attribute. Do not reuse the legacy `.petersmartlink.com` cookie domain or expose tokens to localStorage/client page props.
3. **Session validation and revocation:** the BFF validates the Otya ID session server-side, refreshes through the Auth service binding, rotates refresh credentials, and supports logout/session revocation. Protect state-changing browser requests with origin/CSRF controls.
4. **Server-side tenant authorization:** the BFF obtains the authenticated user identity from Otya ID and calls the canonical OtyaPoint API. The API remains responsible for resolving the company membership, role, branch and work-area permissions. Never trust a browser-provided tenant or role.
5. **OtyaPoint-owned onboarding:** staff invitations, acceptance, activation, suspension and revocation go through OtyaPoint APIs. A verified current Otya ID email must match the invitation; acceptance creates a pending membership; an Owner/Admin must activate it.
6. **One employment source of truth:** remove Prisma/PostgreSQL staff-profile duplication only after the OtyaPoint D1 source of truth, any required backfill/reconciliation, audit history and recovery plan have been tested.

## Cloudflare dashboard runtime decision

The current package uses Next.js 15.1 with ordinary `next dev`, `next build` and `next start` scripts. It has no checked-in OpenNext/vinext configuration or Next.js Worker deployment manifest. The existing API Worker config must not be reused as if it hosts the dashboard.

Cloudflare's current Next.js guidance (updated 5 November 2026) recommends **vinext** as the default Next.js-on-Workers path, but explicitly labels vinext beta and instructs teams to run `npx vinext check` and review compatibility before adopting it. The non-destructive `vinext init` workflow keeps the normal Next.js toolchain available while testing the Workers path. See:
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/

The read-only vinext audit completed successfully: **100% compatible, 13 supported, 0 partial, 0 issues** across the current imports, config, libraries and scanned App Router structure. It also notes that `middleware.ts` is deprecated in Next.js 16; the application currently uses Next.js 15.1, so this is a future upgrade item rather than a current blocker. This is a static compatibility scan, not a production runtime test.

A separate build experiment is now in draft PR #155 (`experiment/opoint-vinext-cloudflare-build`). It runs `vinext init` and `build:vinext` on a separate branch with a staging-named Worker, no prerender, no shared response/data cache, no image optimizer, no Cloudflare credentials, and no deploy step. The existing `next dev`/`next build` scripts and legacy API Worker config remain untouched. Do not connect Auth/D1 service bindings or production secrets during this build-only experiment. If the build passes, review the generated Worker config before a separate staging integration and browser E2E phase.

## Safe implementation order

- [ ] Complete and merge the canonical OtyaPoint workforce API and shared Otya Auth invitation contract only after both PRs' checks pass and reviews are complete.
- [ ] Provision a dedicated staging-only service token and staging Auth route; verify that staging email delivery cannot use production credentials.
- [x] Run the read-only Next.js/vinext compatibility check; record its 100% scan result and Next.js 16 middleware note.
- [ ] Complete the separate Cloudflare vinext build-only spike (PR #155); inspect generated config and build artifacts before any service binding is added.
- [ ] Build the dashboard BFF/session routes on the chosen Cloudflare runtime. Use host-only cookies, refresh rotation, logout/revocation, no-store responses, origin/CSRF checks and server-only service bindings.
- [ ] Replace Supabase middleware, login actions, staff actions and server authorization with Otya ID + canonical OtyaPoint API calls.
- [ ] Add browser E2E tests for login/OTP, session refresh and rotation, logout/revocation, email-bound invitations, Owner/Admin activation rules, company/branch/work-area isolation and CSRF/origin rejection.
- [ ] Verify recovery/backups and staff membership reconciliation before removing Prisma staff-profile usage.
- [ ] Remove Supabase packages, environment variables, files and lockfile references only after a repository-wide import scan and all protected-route tests pass.

## Release boundaries

The current PR work is source-only. No remote D1 migration, Worker deployment, DNS mutation, production secret change, live payment execution or provider operation has been performed. Keep payment execution, provider execution and AI execution disabled until their separate release approvals and operational controls are complete.

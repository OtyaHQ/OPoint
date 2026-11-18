# Opoint web dashboard — legacy authentication migration

**Current finding (11 November 2026):** The existing Next.js management dashboard still has active Supabase Auth dependencies. This is not dead code yet; pages and server actions use it to gate staff access. The new Opoint Cloudflare Worker foundation does not currently replace this entire web session flow.

## Confirmed active references on the current default branch

- `middleware.ts` creates a Supabase server client, calls `auth.getUser()`, and redirects unauthenticated requests to `/login`.
- `lib/auth.ts` calls Supabase `auth.getUser()` and then resolves the staff profile and role through Prisma.
- `app/login/actions.ts` currently signs in using email/password.
- `lib/supabase/server.ts` manages auth cookies.
- `lib/supabase/admin.ts` is used by staff invitations.
- `app/management/staff/actions.ts` uses the admin client.
- The package manifest includes `@supabase/ssr` and `@supabase/supabase-js`; `.env.example` still contains Supabase variables.

Therefore, removing the two dependencies or deleting `lib/supabase/` now would break staff authentication and invitation flows. These items must be migrated, not simply deleted.

## Target replacement

1. Otya ID becomes the only account/session authority and uses email OTP, with Telegram bot as an optional delivery channel only after explicit account linking.
2. The web dashboard stores short-lived Otya ID access and rotating refresh sessions in secure, HttpOnly, SameSite cookies. Tokens never enter localStorage or client-visible page props.
3. Server-side authorization verifies the Otya ID session and then resolves Opoint's company membership and role through the Opoint API. The browser cannot choose the tenant or role.
4. Opoint staff invitations become Opoint-owned commands. The server records the invitation and requests email delivery through an authenticated, narrow Otya End mail interface. No Supabase admin key is retained.
5. Prisma/PostgreSQL staff-profile duplication is removed only after the source of truth has moved to Opoint D1 and migration/backfill/reconciliation has been verified.

## Safe removal order

- First build and stage Otya ID email OTP plus optional linked Telegram bot delivery.
- Migrate Opoint web login, middleware, server actions, API routes, invitations, logout, refresh and revocation to the new Otya ID contract.
- Run role/tenant/branch isolation and CSRF/session rotation tests.
- Remove Supabase Auth imports and environment variables; confirm the build and all protected dashboard routes pass.
- Remove `@supabase/ssr`, `@supabase/supabase-js`, stale Supabase files and old lockfile references only after the dependency scanner confirms no imports remain.
- Keep any unrelated third-party integration credentials until a separate usage audit proves they are unused.

## Current limitation

The new Opoint API Worker foundation is a separate implementation archive and its staging D1 is prepared, but the Worker source has not yet been checked into the product repository or deployed. This dashboard migration is consequently a planned integration gate, not a completed cutover.

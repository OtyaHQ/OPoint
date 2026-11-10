# OtyaPoint frontend–backend connection contract

## Public experience

The public-facing product is **OtyaPoint**. Customers and business visitors should see the OtyaPoint brand, clear navigation, accessible layouts, and useful empty/error states—not internal environment labels, migration names, provider names, database names, or engineering status badges.

Internal architecture and release controls remain documented for maintainers. Removing a visible label must never imply that a capability is active when its service is not connected.

## Connection architecture

- Browser UI → same-origin Next.js route handlers/BFF → authenticated Cloudflare Worker API → D1.
- Keep the Worker origin and service credentials on the server. Do not expose service-binding names, provider secrets, database IDs, or bearer tokens in browser code.
- The frontend must not send role claims as authority. The Worker verifies the Otya Auth token and maps its subject to an active, company-scoped staff membership.
- Use same-origin route handlers as the integration seam where available. This avoids browser CORS coupling and keeps server-only credentials out of client bundles.
- Treat API responses as the source of truth. Do not synthesize products, sales, float balances, commissions, or reconciliation records to make screens look populated.
- Show neutral empty states when no records exist and actionable unavailable/error states when the backend cannot be reached. Do not label customer-facing UI “demo”, “live”, or “preview”.

## Current Worker contract

All routes below are served by the Cloudflare Worker only when that Worker is explicitly configured and reachable. Their presence in source code does **not** mean they are deployed or connected to the public frontend.

| Method | Route | Access and purpose |
|---|---|---|
| GET | /api/products | Authenticated staff; active products scoped to the staff member's company |
| GET | /api/summary | Manager-level summary, scoped to company |
| POST | /api/products | Manager-level product creation; starts with zero stock |
| POST | /api/stock-adjustments | Manager-level, audited stock adjustment |
| POST | /api/sales | Authenticated staff; cash-only retail sale, requires an Idempotency-Key |
| GET | /api/ledger | Manager-authorized ledger view, scoped to the staff member's company |
| POST | /api/bootstrap/sovereign | One-time first-owner provisioning; requires a configured high-entropy Worker secret and verified Otya identity |
| GET | /api/staff | Sovereign-owner staff listing, scoped to the company |
| PATCH | /api/staff/:id | Sovereign-owner role, status, branch and profile changes |
| GET / POST | /api/staff/invitations | Sovereign-owner invitation listing and creation; tokens are one-time, hashed and time-limited |
| POST | /api/staff/invitations/accept | Invitee accepts using their own verified Otya identity and matching email; membership remains PENDING |
| POST | /api/staff/invitations/:id/resend or /revoke | Sovereign-owner invitation resend/token rotation or revocation |
| GET | /api/agency-overview | Authenticated staff; confirmed-only totals and recent local agency records, company-wide for managers and creator-scoped for other staff |
| GET | /api/agency-transactions | Authenticated staff; company-wide for managers, creator-scoped for other staff |
| POST | /api/agency-transactions | Intentionally unavailable until provider adapters and controls are approved |

Worker error responses use a stable JSON error code and may include a requestId. The UI should present a safe message and retain the request ID for support, without displaying internal exception text.

## Frontend data requirements

1. Fetch inventory and overview data through a server-side adapter, not directly from a database or provider.
2. Validate and normalize the API payload at the boundary. Render UGX amounts using integer minor-unit rules confirmed for the relevant operation; do not infer provider amount units.
3. Distinguish an empty successful response from an unavailable API. Empty data is not an error, and an API failure is not an empty inventory.
4. For sale submission, generate a fresh idempotency key for a new attempt and reuse it only when retrying the same unchanged request. Do not offer non-cash methods until the backend explicitly enables them.
5. Do not present an agency transaction as successful unless the backend returns a verified provider-confirmed state. Drafts must not be described as recorded transactions.
6. Handle 401 by asking the user to sign in again; 403 by showing an access-denied state; 409 as a conflict requiring refresh/review; 422 as a capability or validation issue; and 503 as a temporary service-unavailable state.
7. Do not cache authenticated business responses in shared/public caches.

### Agency overview behavior

`GET /api/agency-overview` is a read-only operations summary over OtyaPoint's own D1 records. Manager roles receive company-scoped totals and recent records; other active staff receive only records where they are the creator. Amount and commission totals include only rows with `provider_status = SUCCEEDED`. Pending/unknown and failed records are counted separately. It does not call Interswitch, Quickteller, Airtel or MTN, create transactions, post ledger entries, or represent an unconfirmed amount as received.

## Readiness and release gates

The source-level API contract includes the owner bootstrap and staff invitation routes, but end-to-end frontend connectivity is **not yet certified**. Production `otyapoint-db` now records migrations `0001–0009`; migrations `0004–0009` were applied on 2026-11-09 after first validating the same sequence on the isolated restore-verification D1 database. Production verification confirms all 13 expected business tables and the required idempotency, owner, invitation, immutable-history, and cash/float integrity objects are present. All 13 business tables remain empty. The private `otyapoint-api` Worker has a published Cloudflare deployment, but `workers_dev` is disabled and no public route or custom domain is attached. The dashboard is not yet certified against it. At the 2026-11-10 inspection, all 13 expected business tables were empty; no owner membership, products, staff or sales had been provisioned. The agency-provider write route remains disabled, and the local cash/float records do not call a provider or enable live money movement. Before connecting a public deployment, maintainers must verify:

- an approved Worker deployment and service binding/origin configuration;
- a real sign-in flow and securely provisioned staff membership;
- matching frontend proxy routes and backend paths;
- request/response schemas and authentication forwarding;
- company/branch authorization tests;
- API failure, timeout, empty-state and idempotency behavior;
- database migration compatibility, backup/restore, and audit/ledger invariants;
- CI checks passing and browser/device verification.

Do not deploy, change DNS, alter secrets, enable provider execution, or process live financial transactions as part of this contract alone.

## Authentication contract discovery (2026-10-30)

The connected OtyaEnd repository was inspected read-only. Its Auth Worker documents and implements these server endpoints:

- `POST /auth/login`: send JSON `{ email, password }`. The source validates both fields, normalizes email, applies IP/email attempt limits, and returns `{ ok: true, access_token, refresh_token, user: { id, email, name, avatar_url, is_verified } }` on success. Invalid credentials return 401; throttling returns 429.
- `POST /auth/refresh`: request JSON includes `refresh_token`; successful response includes a new `access_token` and may include a rotated `refresh_token`.
- `POST /auth/logout`: revoke the refresh token server-side; confirm the exact request/response behavior from the current route before wiring logout.
- `GET /auth/verify`: bearer access-token verification; the OtyaPoint Worker specifically requires `{ ok: true, user_id: <non-empty string> }`. Verify the current handler's error responses and exact behavior for expired/revoked tokens in integration tests.

This establishes the source-level payload shape, **not** a production-ready OtyaPoint browser session. The current Otya Auth Wrangler entrypoint is `src/production-entrypoint-miniapp.ts`, which wraps the production entrypoint and refresh-token store. OtyaPoint's existing Next.js app does not currently demonstrate a verified Cloudflare service binding/runtime configuration, cookie-domain decision, CSRF/origin controls, refresh rotation behavior, or login/session integration tests. Do not copy cookie-domain settings from another app or assume that the dashboard is hosted under the same parent domain. Validate those deployment facts before implementing browser cookies or forwarding tokens.

The safe next implementation unit is a same-origin session BFF with HttpOnly Secure SameSite cookies, strict same-origin checks for mutating requests, bounded request bodies, no token logging, refresh/logout revocation, and tests for auth outage/rotation/replay. Until that BFF is implemented and tested, keep the product bridge fail-closed and keep legacy authentication dependencies in place; do not mint local JWTs or accept browser-provided identity/role claims.


### Session implementation checklist

Before changing the login action, implement a server-only Auth adapter that can run in the selected OtyaPoint runtime. The runtime is not yet verified, so do not assume Next.js Node APIs or Cloudflare bindings are available in the same environment. Required acceptance tests:

- successful login never returns either token to the browser page, form action result, redirect URL, or logs;
- invalid credentials and throttling produce generic, non-sensitive UI messages;
- refresh rotates tokens safely, including concurrent refresh attempts and upstream timeouts;
- logout revokes the refresh token and clears both cookies using exactly the same Path, Domain, Secure, HttpOnly and SameSite attributes used to set them;
- mutating same-origin routes reject mismatched Origin/Host and apply CSRF protection; redirects allow only relative paths beginning with one slash;
- missing/failed Auth binding returns a non-cacheable service-unavailable response and never falls back to legacy Supabase identity;
- after authentication, every business API call independently verifies the access token and maps `user_id` to an active staff membership in D1;
- cookies' Domain/Path are chosen only after the actual public dashboard hostname and hosting topology are confirmed. Do not copy a parent-domain cookie configuration from another Otya application.

The existing OtyaPoint login action still calls Supabase. It must remain unchanged until the replacement is implemented against a verified runtime and the above tests pass; otherwise a partial migration could lock out existing users without providing a working alternative.

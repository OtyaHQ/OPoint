# OtyaPoint frontend–backend connection contract

## Public experience

The public product is **OtyaPoint**. Customer-facing screens should be clear, accessible and honest about what is available. Do not expose internal environment labels, database names, migration details, provider credential names, private service routes or engineering status badges.

A capability must not appear active merely because a backend route exists in source.

## Connection architecture

- Browser → same-origin server-side session boundary → authenticated OtyaPoint API → product-owned business data.
- The server verifies the Otya identity and maps it to an active OtyaPoint staff membership.
- The backend, not the browser, determines role, company and branch scope.
- Provider secrets and service credentials stay on the server.
- Business records are written through one authorized API boundary; do not introduce dual writers.
- UI values must come from authoritative API responses. Never fabricate stock, sales, balances, float, commissions or reconciliation results to make a screen appear populated.

## Frontend behavior

1. Show an empty state when the API successfully returns no records.
2. Show a distinct unavailable state when the service cannot be reached.
3. Ask the user to sign in again on an expired session.
4. Show access-denied and conflict states without exposing internal exception details.
5. Use a fresh idempotency key for a new retail-sale attempt and reuse it only for a retry of the same unchanged request.
6. Do not offer a non-cash method unless the backend explicitly enables that method.
7. Do not describe an agency transaction as successful until trusted provider status confirms it.
8. Keep authenticated business data out of shared/public caches.

## Financial and provider boundaries

Retail cash sales and mobile-money agency transactions are separate records and workflows. Confirmed amounts and commissions must be derived from verified records, not from a UI guess.

InterSwitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money are distinct provider integrations. Each needs its own approval, credential custody, callback verification, idempotency, timeout handling, reconciliation and release evidence. No provider write capability should be enabled merely because a sandbox request succeeds.

## Readiness

The API foundations are present, but the dashboard's replacement sign-in and business-data connection has not yet passed end-to-end acceptance. The replacement business system has not yet been provisioned with the first owner or operating records.

Public product and developer information belongs in OtyaHub. Private implementation and release runbooks must be kept in controlled Otya operations records.

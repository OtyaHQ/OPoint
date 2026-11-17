# OtyaPoint domain and service identity

## Principle

OtyaPoint is a product in the Otya ecosystem. Public domains are changeable addresses; they are not product, company, tenant, user, staff, transaction, database or service identities.

The current public brand is **OtyaPoint**. This repository owns the business application and its business data. Shared identity and public customer surfaces are owned by Otya End.

## Stable identity boundaries

- Product identity: `otyapoint`.
- Shared identity service: `otya-auth`.
- Business tenant: the existing internal company key remains unchanged until an audited tenant migration is approved.
- Worker identity: `otyapoint-api`.
- Database identity: the bound Cloudflare D1 database ID, not a domain or database display name.
- Authentication: Otya Auth user IDs plus OtyaPoint membership/role records.
- Public URLs: configuration values only; never database keys or authorization subjects.

Do not rename the existing legacy tenant key, database objects, migration identifiers, Worker bindings, provider fields or stored business history just to remove old wording from a screen. A data-identity change requires an explicit, reversible migration with row-count, ledger-total, access-control and restore checks.

## Network topology

The OtyaPoint API Worker remains private:

- `workers_dev = false`.
- No public custom domain or route is configured.
- Staff invitations and identity verification use Cloudflare Service Bindings to Otya Auth.
- Public-facing APIs must pass through an approved Otya gateway and a product-specific authorization boundary.
- Do not embed the OtyaPoint Worker URL in a browser or mobile build.
- Do not use a public website hostname as the internal Worker-to-Worker address.

This keeps the business API independent of the current Otya website domain and avoids exposing financial and staff operations directly to the public internet.

## Public address discovery

When the dashboard and mobile surfaces are connected to the approved Otya session gateway, they must obtain their endpoint from a versioned Otya configuration contract. The configuration contract must support:

- current primary API origin;
- approved secondary/failover origins;
- a version and expiry;
- minimum supported client version;
- TLS-only origin validation;
- health-checked failover;
- last-known-good configuration and rollback.

An endpoint manifest must be signed by Otya infrastructure before a client accepts a changed origin. Do not fetch arbitrary URLs or credentials from unsigned remote configuration. The current dashboard-to-backend authentication bridge is not yet certified; do not bypass that release gate.

## Email and notifications

OtyaPoint should call the Otya-owned notification service for transactional messages. The shared Resend account and sender-domain configuration belong to the Otya platform. Do not create separate Resend accounts or commit provider keys in this repository. OtyaPoint must never receive the Resend API key when a service binding can perform delivery.

## Domain-change checklist

A future domain change should update edge and client configuration, not business data:

1. attach the new domain to the Otya public gateway and confirm SSL;
2. update the signed endpoint manifest and host/origin allowlists;
3. verify Otya Auth redirects, CSRF/origin rules and host-only cookies;
4. verify dashboard, Android, downloads, assets, callbacks and webhooks;
5. test health and failover from each approved origin;
6. retain temporary aliases only while older supported clients require them;
7. remove old aliases after measured traffic and callback evidence reaches zero.

## Current status

The API Worker remains private and domain-independent. The dashboard session bridge, signed endpoint manifest, multi-origin client failover, production business-data cutover and live provider writes remain gated and are not represented as completed by this document.

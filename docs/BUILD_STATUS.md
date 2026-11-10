# OtyaPoint build and operational status

Last reviewed: 2026-11-10.

This is a public-safe product summary. It does not publish internal infrastructure inventories, account identifiers, storage names, recovery paths, credential metadata or private operations procedures.

## Product architecture

- Otya provides shared account identity.
- OtyaPoint owns its shop and agency business authorization and records.
- Cloud services provide the server-side runtime, relational data, private storage and asynchronous processing where needed.
- Resend is the shared transactional email provider.
- GitHub maintains source, review and automated validation.
- Financial records remain under the relevant product's server-side authorization boundary.

## Current implementation status

- Product-scoped API foundations and schema migrations are present in source.
- Automated tests cover important authorization, retail, idempotency and financial-history constraints.
- The dashboard has not yet passed end-to-end acceptance against the replacement authentication and business-data flow.
- The replacement business system has not yet received its first owner, products, staff memberships or sales.
- Retail cash operations remain gated on secure owner provisioning and dashboard integration.
- Agency-provider writes remain disabled. No live payment or payout capability is approved.

## Release gates

Before customer use, verify the authenticated browser session, server-side staff membership, role/company isolation, inventory, cash-sale idempotency, balanced ledger, audit history, backups, restore rehearsal, monitoring, rollback and clear failure states.

Before financial-provider activation, separately verify the provider contract, merchant approval, credential custody, callback signatures, idempotency, reconciliation, reversal handling and regulatory requirements.

## Preservation rule

Do not delete legacy data, databases, recovery copies, compatibility paths or old application code merely to simplify the repository. A migration is complete only after export, reconciliation, restore verification, single-writer cutover and rollback have all been evidenced.

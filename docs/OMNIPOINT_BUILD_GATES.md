# OtyaPoint product-completion gates

OtyaPoint is not considered ready for customer operations simply because its source compiles or its backend foundations are deployed.

## Product gates

- Sign-in uses the shared Otya identity.
- Shop access is provisioned through an active OtyaPoint staff membership.
- Inventory, stock, cash sales, staff, ledger and reports use authoritative backend responses.
- Retail cash and agency cash/float remain separate.
- The UI provides honest empty, unavailable, denied and conflict states.
- Audit and financial history are immutable and corrections are recorded as new events.

## Integration gates

- The dashboard's same-origin session boundary is verified.
- The product API is authenticated and isolated from public access until preview acceptance.
- Provider adapters remain separate and write-disabled until partner approval.
- Idempotency, callback verification, timeout and reconciliation behavior are tested.
- Backups, restore, monitoring and rollback are evidenced.

## Current status

The backend foundations exist, but the dashboard connection has not passed end-to-end acceptance and the replacement business system has not been provisioned with the first owner or operating records. Mobile-money and bill-payment writes remain disabled.

Detailed release authority, internal infrastructure, deployment identifiers and recovery procedures are private Otya operations information.

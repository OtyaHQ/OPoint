# Mobile-money and bill-payment provider readiness

## Provider boundary

OtyaPoint treats InterSwitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money as distinct provider integrations. Quickteller Business is not an alias for InterSwitch Marketplace Routing; credentials, account types, token flows, biller catalogues and request contracts must never be mixed between them.

## Public status

- Provider integrations are not approved for live money movement.
- Any sandbox-only diagnostic is separate from payment initiation.
- No provider transaction should be represented as successful without verified provider evidence.
- Unknown outcomes remain pending until independently reconciled.
- Refunds, payouts, wallet-balance access and live settlement must not be inferred from a read-only sandbox capability.

## Required controls before activation

- Confirm the current merchant onboarding and legal-entity requirements directly with the provider.
- Use the correct provider product and account profile.
- Store credentials in a private server-side secret manager with least-privilege scope.
- Verify callback signatures and provider status transitions.
- Use idempotency keys for retryable operations.
- Handle duplicate callbacks, timeouts, unknown states and reversals.
- Reconcile provider, cash, float, commissions and ledger totals.
- Complete compliance and operational acceptance before enabling customer-facing writes.

## Credential custody

This public repository must not contain provider tokens, client secrets, merchant identifiers, account metadata or secret-store configuration. Detailed provider onboarding and credential-custody records belong in private Otya operations records.

A successful sandbox token request is not approval for production money movement.

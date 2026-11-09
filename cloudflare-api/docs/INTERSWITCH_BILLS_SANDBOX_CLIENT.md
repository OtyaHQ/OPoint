# InterSwitch Marketplace Routing Bills Payment — sandbox client

This module provides an isolated, typed **sandbox-only** client for the Marketplace Routing VAS endpoints. It is not connected to the OtyaPoint Worker router, D1 ledger, dashboard, queues, or payment posting workflow.

## Supported operations

- Discover billers: `GET /v1/vas/billers`
- Read payment items: `GET /v1/vas/billers/payment-item?biller-id=...`
- Validate a customer: `POST /v1/vas/validate-customer`
- Query a transaction: `GET /v1/vas/transactions?request-reference=...`
- Sandbox payment: `POST /v1/vas/pay`, disabled unless a caller explicitly opts in.

The client has a fixed sandbox hostname and no live URL. The caller supplies the access token server-side. No token acquisition or provider secret is included in this module.

## Important contract limits

The sandbox host is not evidence that a Uganda biller is enabled for this merchant. The amount is constrained to a positive safe integer, but the client deliberately does not infer the provider's amount scale or currency field. The Marketplace Routing request example does not establish that the Bills endpoint accepts the `CurrencyCode` field used by a separate checkout API. Do not add undocumented currency fields or convert UGX amounts without provider confirmation.

The customer-validation body follows the supplied dashboard example and remains subject to provider sandbox confirmation. The client does not interpret a response as a final paid bill, create a D1 agency transaction, post a ledger entry, or alter cash/float balances.

## Money safety

- Payment submission defaults OFF.
- Payment submission cannot reach a production/live endpoint through this client.
- A transport timeout is ambiguous. Query the same provider reference before considering a retry.
- Provider errors and response bodies are not included in exception messages.
- No UI, route, queue or scheduled job imports the client.
- Interswitch Marketplace Routing remains distinct from Quickteller Business.

## Before connecting to the agency workflow

1. Confirm auth header/token requirements in the official Marketplace Routing contract.
2. Confirm biller and payment-item availability for Uganda and this merchant/terminal.
3. Confirm the amount unit, currency selection, fee semantics and reference uniqueness.
4. Verify response statuses for validation, pending, confirmed, failed and unknown.
5. Confirm transaction lookup semantics and duplicate submission behavior.
6. Add a separate provider adapter and connect it only behind owner-approved sandbox settings. Production activation requires partner approval, callback/status verification, idempotency, reconciliation, and separate explicit owner authorization.

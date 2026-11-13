# Opoint financial posting engine — staging implementation

## Status

This branch adds an internal journal validator and D1 posting primitive with unit tests. It is not wired to a public HTTP route. The capability contract must continue to report `journalPostingEnabled: false`, `salesPostingEnabled: false`, `cashMovementEnabled: false`, and `providerExecutionEnabled: false`. Do not change those flags as part of routine development.

## Posting contract

- All monetary amounts are integer UGX; reject floats, negatives, unsafe integers and values outside the configured per-line bound.
- A journal has 2–100 lines. Each line has exactly one positive debit or credit amount.
- Debit total must equal credit total and be greater than zero.
- Every referenced account must be active, UGX-denominated and owned by the same company.
- The source is unique by (company, source type, source ID); the idempotency key is unique per company and may only replay the same source.
- Insert the header as DRAFT, insert all lines, then transition it to POSTED in one D1 batch. The financial-integrity trigger independently validates the balance at posting time.
- Posted journal entries are immutable. Corrections use a separately authorized reversing entry; never update/delete posted lines.
- Never call a provider from inside the D1 batch. Provider operations use a durable outbox/Queue and explicit unknown/pending/reconciliation states.

## Remaining integration work

1. Add the sales domain service that calculates line totals from server-side product prices and stock, never client-supplied costs.
2. Add cash-session open/close and payment allocation validation.
3. Add sale posting with inventory movements, sale status, payment allocations and journal posting in a single atomic D1 batch.
4. Add refund/reversal workflows as separate compensating entries.
5. Add concurrency tests against a real isolated D1 database, duplicate idempotency tests, insufficient-stock tests and fault injection at each batch boundary.
6. Add approval policies for discounts, voids, cash variances, expense approvals and manual settlement adjustments.
7. Keep provider-specific adapters separate (MTN MoMo, Airtel Money, Quickteller, InterSwitch, EFRIS); never treat an API acceptance response as settlement proof.

## Release gates

No production activation until accounting review, provider sandbox certification, callback signature/deduplication, daily reconciliation, fraud controls, privacy/security review, Uganda regulatory review, disaster-recovery rehearsal, and owner sign-off are complete.

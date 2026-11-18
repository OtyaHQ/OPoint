# Opoint POS sale calculation contract

The isolated backend now contains a pure sale calculation primitive. It accepts server-resolved product price/cost snapshots, integer quantities, per-line discounts and a trusted server-calculated tax amount. It does not accept client-supplied total amounts, does not mutate stock, does not accept payments and is not exposed as an HTTP route.

## Invariants

- UGX is represented as integer minor units (whole shillings), never floating-point values.
- A sale has 1–100 lines; quantity is a positive bounded integer.
- Price, cost, discounts and tax are non-negative safe integers.
- Each line discount cannot exceed its gross amount.
- Gross subtotal, discounts, cost and final total are bounded and safe integers.
- Persisted sale lines must snapshot product SKU/name/price/cost at time of sale; future catalog edits must not rewrite history.

## Before enabling a POS route

1. Resolve products from the authenticated company's catalogue on the server; ignore client-supplied price/cost.
2. Resolve stock by company, branch and inventory location; reject insufficient stock.
3. Enforce role-based discount limits and approval for overrides.
4. Persist the sale draft and line snapshots with an idempotency request fingerprint.
5. On completion, validate the active cash session and every payment allocation.
6. In one atomic D1 batch, insert stock movements, sale payment allocations, balanced journal entry/lines and transition the sale to COMPLETED.
7. Use the database guards for immutable posted journals and completed sale lines.
8. Send receipt/email/FCM only through a durable outbox after the business transaction commits.
9. Test concurrent sales against the same stock, duplicate requests, retries, partial payments, cash variances, voids and reversals against an isolated D1 database.

All write routes and capabilities remain disabled until these controls and independent accounting review are complete.

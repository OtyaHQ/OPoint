# OtyaPoint agency readiness

**Route:** `GET /api/agency-readiness`  
**Access:** authenticated active staff with a management role  
**Effects:** read-only; no provider request, transaction creation, ledger posting or external side effect

The response summarizes only OtyaPoint D1 records belonging to the authenticated staff member's company. It includes total, pending, unknown-result counts and counts grouped by locally recorded provider.

Interswitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money are reported separately as `NOT_READY` / `NOT_IMPLEMENTED`. The response sets `mode: LOCAL_RECORDS_ONLY`, `liveMoneyEnabled: false`, and explicitly states that transaction creation remains disabled.

A zero count means only that there are no matching rows in this OtyaPoint database. It does not establish the absence of older records in any separate legacy system. Provider status values describe the implementation state and do not imply partner approval, credentials or live connectivity.

This endpoint supports the management operations view; it is not a payment initiation API. Do not enable provider writes until adapter contracts, credentials, trusted status/callback verification, idempotency, reversals, ledger and reconciliation controls, and Uganda partner approval are verified and separately authorized.

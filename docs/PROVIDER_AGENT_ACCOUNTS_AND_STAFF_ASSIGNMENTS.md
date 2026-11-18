# Provider-agent accounts and staff assignments

## Purpose

A provider's registered agency account is not an employee identity. OtyaPoint models the outlet/provider account separately from the people authorised to operate it.

The relationship is:

1. **Otya ID identity** identifies the person who signs in.
2. **OtyaPoint staff membership** grants that identity membership in a company and may scope it to a branch.
3. **Work-area assignment** grants Retail, Mobile Money, or both, with a branch-specific duty role.
4. **Provider-agent account** records the company's Airtel Money or MTN MoMo agency account for a branch.
5. **Provider-agent staff assignment** links a staff member to that provider account with a separate duty role.

A staff member may therefore be assigned to Retail and Mobile Money, and may be separately assigned to one or more approved provider-agent accounts. Access to one provider account does not grant access to another provider, another branch, KYC data, owner administration or all company functions.

## Provider account records

A provider-agent account belongs to a company, branch and provider. It records a provider-issued agent/outlet reference, a display label, optional last four digits of the agent line, and the provider-approval reference entered during activation.

The provider reference must be an agent/outlet code, not a full phone number. OtyaPoint stores only the optional last four digits of a line identifier. It does not store the complete MSISDN or personal KYC contact number.

New accounts begin as `PENDING`. An Owner/Admin can activate one only after recording a provider-approval reference. This is an auditable owner attestation; the current implementation does **not** contact Airtel or MTN to independently verify that reference. A pending, suspended or revoked account must not be used for operations.

## Staff assignment rules

- Only company Owner/Admin can create and manage provider-agent accounts and assignments.
- A provider account must be active and belong to an active branch before a staff assignment can be created.
- The staff membership must be active and belong to the same company.
- The employee must have an active `MOBILE_MONEY` work-area assignment at the provider account's branch.
- The provider-account duty cannot exceed the employee's Mobile Money work-area duty.
- Revoked assignments are terminal. Suspended assignments can be resumed only while the provider account, branch, staff membership and underlying Mobile Money work assignment are active and compatible.
- Every creation and status change writes an append-only event and a company audit event.

The same person can have different duties on MTN and Airtel accounts. The provider's own agency agreement and operating rules determine whether a particular staff arrangement is permitted in practice.

## API

All routes below require an authenticated Otya ID token, an active company membership and the company context in `x-company-id` or `companyId`. Provider account management is Owner/Admin-only.

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1/provider-agent-accounts` | List accounts; optional `branchId` and `providerCode` filters |
| POST | `/v1/provider-agent-accounts` | Create a pending provider account; requires an idempotency key |
| POST | `/v1/provider-agent-accounts/:id/status` | Activate, suspend or revoke an account |
| GET | `/v1/provider-agent-accounts/:id/staff-assignments` | List staff assigned to one account |
| POST | `/v1/provider-agent-accounts/:id/staff-assignments` | Assign an active Mobile Money worker; requires an idempotency key |
| POST | `/v1/provider-agent-accounts/:id/staff-assignments/:assignmentId/status` | Suspend, resume or revoke a staff assignment |

Accepted providers are `MTN_MOMO` and `AIRTEL_MONEY`. Account activation requires a provider approval reference. It does not enable provider API transactions.

## Data protection boundary

The API rejects request fields intended to carry credentials or raw identity data, including PINs, OTPs, passwords, API keys, tokens, complete phone/MSISDN values, national-ID details and KYC documents. Employee authentication and identity verification remain with Otya ID and the approved company/provider processes. OtyaPoint keeps only the minimum membership and provider-assignment metadata required for business authorisation.

Do not add a raw customer PIN, OTP, employee KYC document, national ID scan, password, provider login credential or full personal phone number to these tables, logs, audit records or issue reports.

## Financial execution boundary

This work adds account and staff authorisation metadata only. It does not initiate, confirm, reverse or settle Airtel/MTN transactions. Provider execution, cash movement, sales posting, journal posting, bill payment and AI execution remain disabled in the staging capabilities contract until their separate security, provider, reconciliation and release gates have passed.

Any future provider transaction route must independently verify, server-side and on every request:

- active company membership and branch;
- active Mobile Money work-area assignment and compatible duty;
- active provider-agent account for the requested provider and branch;
- active staff assignment to that exact provider-agent account;
- trusted provider transaction status, idempotency, callbacks, reversals and reconciliation.

A UI-hidden tab or cached staff assignment is never sufficient authorisation.

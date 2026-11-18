# OtyaPoint provider operator access

## Canonical data model

This implementation uses the OtyaPoint enterprise schema introduced by migrations 0005 and 0006. It does not create parallel provider-account, staff-profile or assignment tables.

- **Otya ID / staff membership** identifies the person and their company membership.
- **Employee profile and employee assignment** record the company employment record and branch appointment.
- **Staff work assignment** grants the separate branch-scoped `MOBILE_MONEY` work area.
- **Provider relationship** in this operator workflow records the company's Airtel Money or MTN MoMo agency relationship.
- **Provider outlet account** records the exact provider account for a branch, for example an `AGENT_FLOAT` account.
- **Company SIM asset** records company-owned SIM inventory and its assignment to an employee. Its registered MSISDN is not the employee's KYC identity contact.
- **Provider operator profile** connects an employee to one provider relationship and one outlet account, with a provider operator reference, training and approval status.
- **Employee permission grant** grants the narrow `MOBILE_MONEY:OPERATE` permission scoped to that exact provider outlet account.

A worker can separately have Retail and Mobile Money work assignments. Having the Mobile Money work area does not automatically grant access to every provider outlet. The worker needs an approved provider operator profile and an active permission grant for the exact outlet account.

## Approval requirements

A provider relationship may be marked ACTIVE only after an owner/admin records both the corporate agent reference and agreement reference. This is an auditable company attestation; the API does not independently verify the provider's records.

An outlet account begins as PENDING. It can become ACTIVE only when its provider relationship is ACTIVE and the provider-issued outlet/account reference is present.

A provider operator profile begins as PENDING. It can be marked APPROVED only when:
- the provider relationship and outlet account are ACTIVE;
- the employee profile and branch employment assignment are ACTIVE;
- the employee has an active Mobile Money work assignment at that same branch with an operator-capable duty;
- provider operator reference is recorded;
- provider-required training is marked COMPLETED;
- any attached SIM is a company-registered SIM of the correct network and is assigned to that employee at that branch.

The database also enforces the active operator checks on insert/update. When a provider relationship or outlet account is suspended/closed, associated profiles and scoped permission grants are suspended or revoked. Re-enabling an account does not silently re-enable an operator; re-approval is explicit.

## API

All company management routes require Otya ID authentication, an active company membership and Owner/Admin company role. Company context is supplied in `x-company-id` or `companyId`.

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/v1/provider-relationships` | List or create company-level provider relationships |
| POST | `/v1/provider-relationships/:id/status` | Record onboarding, approval, suspension or closure state |
| GET/POST | `/v1/provider-outlet-accounts` | List or create branch-level provider outlet accounts |
| POST | `/v1/provider-outlet-accounts/:id/status` | Activate, suspend or close an outlet account |
| GET/POST | `/v1/provider-outlet-accounts/:id/operators` | List or assign employee operator profiles to an outlet |
| POST | `/v1/provider-operator-profiles/:id/status` | Approve, suspend, reject or revoke a provider operator profile |
| GET | `/v1/me/provider-operator-assignments` | List only the signed-in employee's currently authorised provider outlets |

Provider-account and operator management changes are recorded in the company audit trail. Business uniqueness constraints make repeated creation requests return the existing matching provider/outlet/operator record where possible.

## Identity and SIM boundary

Do not enter an employee's KYC phone number as an Airtel/MTN operator account identifier. Store an employee's personal identity and KYC documents only in the approved restricted identity/document workflow. A company-owned agent SIM is registered as a company asset and associated with the provider operator profile through its SIM asset ID. Public and worker list APIs do not return the full SIM MSISDN.

The API rejects PINs, OTPs, passwords, API tokens, personal phone numbers, national ID and raw KYC document fields. It does not access an SMS inbox, notification feed or provider application credentials.

## Financial execution boundary

These routes manage provider relationships, outlet accounts and operator permissions only. They do not initiate, confirm, reverse or settle transactions. Payment execution, cash movement, sales posting, journal posting, bill payments, airtime/data execution and AI execution remain disabled. A provider transaction must still be recorded as unverified until trusted provider evidence or an official statement confirms its outcome.

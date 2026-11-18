# OtyaPoint workforce and provider access contract

**Status:** Review branch implementation. This document describes the canonical Worker API in source; it does not claim that the Worker is deployed or that the dashboard is connected.

## Identity and authority layers

Otya ID authenticates the person. OtyaPoint then resolves an active company membership using the authenticated identity subject. Access is not granted by a browser-supplied role, employee number, phone number, SIM identifier, or device identifier.

The records are deliberately separate:

1. **Identity:** Otya ID account and its login/session security.
2. **Company membership:** the person's membership, company role and status.
3. **Employee profile:** employment number, employment status, position and department.
4. **Employee assignment:** which branch the employee is assigned to and the effective dates.
5. **Work-area assignment:** Retail or Mobile Money, with a separate duty role at the branch.
6. **Provider operator profile:** provider-issued operator reference, training/approval status and the associated provider outlet.
7. **Permission grant:** exact provider-account scope and validity period. It is not a substitute for the records above.

An employee may hold Retail and Mobile Money assignments at the same branch. Neither assignment grants access to the other work area.

## Authentication and request scope

The Worker expects a bearer access token issued by Otya ID and validates it through its private Otya ID service binding. Company context is resolved against that identity.

For company-scoped endpoints, the current contract accepts the company context in `X-Company-ID` or the `companyId` query parameter. The server must still verify that the authenticated identity has an active membership in that company. A company ID in a request is a selector, never proof of access.

A branch selector is similarly validated against the company. Non-privileged membership is restricted to its default branch and active branch work assignments. Owners and administrators can administer company work assignments and view the company workforce directory.

Browser applications must call the API through a server-side session boundary. Access/refresh tokens must not be persisted in localStorage, exposed in client props, or sent to client-side telemetry.

## Read and management endpoints

| Method and path | Access | Purpose |
|---|---|---|
| `GET /v1/me` | Authenticated identity | Return the caller's active company memberships |
| `GET /v1/me/work-assignments` | Authenticated identity | Return the caller's active branch work assignments |
| `GET /v1/branches?companyId=…` | Active company member | Owners/admins see active company branches; other staff see only their default or explicitly assigned active branches |
| `GET /v1/staff?companyId=…` | Owner/admin | Read a company workforce directory, optionally filtered by a validated branch |
| `GET /v1/staff/work-assignments?companyId=…` | Owner/admin | List branch-scoped Retail/Mobile Money work assignments |
| `POST /v1/staff/work-assignments?companyId=…` | Owner/admin | Create an idempotent work assignment; send an `Idempotency-Key` header |
| `POST /v1/staff/work-assignments/{id}/status?companyId=…` | Owner/admin | Suspend, resume or revoke an assignment with a reason |
| `GET /v1/me/provider-operator-assignments` | Authenticated identity | Return only the caller's currently valid approved provider operator assignments |

The workforce directory exposes staff membership and limited employment metadata. It must not expose national identity numbers, passport details, KYC documents, authentication secrets, SIM serials or full provider credentials.

## Retail and Mobile Money isolation

Business routes enforce the relevant branch work-area assignment on the server. A Mobile Money-only worker must be denied Retail catalogue, sales and inventory routes. A Retail-only worker must be denied Mobile Money agency routes. The browser hiding a button is not an authorization control.

Work assignment states are `ACTIVE`, `SUSPENDED` and `REVOKED`. Suspended assignments may be resumed only after a fresh authorization check. Revoked assignments are terminal; create a new reviewed assignment rather than restoring a revoked record.

## Provider operator access

Provider relationships and outlet accounts are separate from employee identity and employment. Airtel Money and MTN MoMo operator approval requires the active company/provider relationship, active branch outlet, active employee/branch assignment, active Mobile Money duty, provider-issued operator reference, completed training and an optional correctly registered company SIM assigned to that employee at the same branch.

A company SIM number is an operational/provider asset. It is not the employee's KYC phone number, account login identifier or proof of a trusted Android device.

An approved operator receives an outlet-specific `MOBILE_MONEY:OPERATE` permission grant. Suspending or revoking the branch Mobile Money assignment automatically suspends/revokes its linked provider operator profile and grant. Resuming a work assignment does not silently reinstate provider approval; provider approval must be reviewed again.

InterSwitch Marketplace Routing and Quickteller Business are separate bill-payment/merchant integrations. They are not Airtel/MTN mobile-money agent identities and must not be stored as mobile-money operator account types.

Provider account status, employee operator approval and staff-recorded receipts do not themselves initiate provider transactions. Actual payment execution remains disabled until provider contracts, approval, credential custody, trusted status verification, idempotency, reconciliation and release controls pass.

## Invitation, acceptance and membership lifecycle

Staff invitations are company-scoped, email-bound and one-use. Only an Owner or Admin can create/list/revoke them; only an Owner can invite another Admin. Normal invitations may assign Admin, Manager, Cashier, Agent, Accountant or Auditor roles. The Owner role is never assigned through a normal staff invitation.

The invitation token is a random 256-bit value delivered only through the private Otya Auth service-binding route. OtyaPoint stores only its SHA-256 digest. Redemption requires a valid Otya ID session, a verified Otya Account email that matches the invitation address, a pending and unexpired invitation, and an available company/branch. An accepted invitation creates a **PENDING** staff membership; it does not activate shop access.

An Owner/Admin must explicitly activate the pending membership through `POST /v1/staff/{membershipId}/status`. Admins cannot activate/manage another Admin; only an Owner can do that. Ordinary staff controls cannot change an Owner membership or perform ownership transfers. Membership activation, suspension and revocation are recorded in append-only membership history and audit events.

Suspending a membership automatically suspends all of that person's active branch work assignments. Revoking a membership revokes all active or suspended work assignments. Those transitions also cascade to provider operator profiles and Mobile Money permission grants. Re-activating a suspended membership does **not** restore old work assignments or provider approvals; the Owner/Admin must review and reassign duties, and provider approval must be separately re-approved. Revoked memberships and revoked work assignments are terminal.

Useful routes:

- `POST /v1/staff/invitations` — create an invitation.
- `GET /v1/staff/invitations` — list company invitations (no token or digest is returned).
- `POST /v1/staff/invitations/{id}/revoke` — revoke a pending invitation.
- `POST /v1/staff/invitations/accept` — redeem a token while signed in to Otya ID.
- `POST /v1/staff/{membershipId}/status` — activate, suspend or revoke a membership.

Invitation email delivery is fail-closed and uses the private Otya Auth route; OtyaPoint never receives a Resend API key. The staging deployment has no invitation service token binding yet, so invitation emails must remain disabled until a dedicated staging token and matching isolated Auth service are configured. Do not copy the production secret into staging.

## Device trust and remaining UI work

The provider operator API can check assignment of a company SIM asset. This is not Android hardware attestation, device-bound session proof or evidence that the phone is uncompromised. A client-supplied device ID must never be accepted as that proof.

Otya ID currently provides account sessions and session revocation, but the OtyaPoint browser-to-Worker server-side session bridge and a generic device-bound proof flow still require an end-to-end implementation and security review. Do not label devices as trusted until that contract exists and is tested.

The legacy Next.js dashboard still contains active Supabase Auth/Prisma login and staff-management code. Do not remove those dependencies or point the public dashboard at this API until Otya ID session handling, server-side role resolution, staff onboarding/invitations, CSRF/session rotation, branch isolation and browser acceptance tests are complete. The workforce screen must consume these canonical APIs; it must not write to Prisma or create a second employee/provider data model.

## Release boundary

- Forward migrations `0007_provider_operator_access` and `0008_staff_invitations` are source-only until the separately authorized isolated staging migration workflow is run.
- No production D1 migration, production Worker deploy, DNS change, secret change, data import or live payment execution is part of this branch.
- Passing source/CI tests proves the tested code contracts only; it does not prove provider onboarding, a successful live device trust flow or production readiness.

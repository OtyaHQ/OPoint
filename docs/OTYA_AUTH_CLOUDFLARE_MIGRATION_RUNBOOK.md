# OtyaPoint account and backend integration principles

This public document summarizes the intended trust boundaries. It is not a deployment, data-migration or account-recovery runbook.

## Product trust boundaries

1. **Otya Auth owns identity:** sign-in, token issuance, refresh rotation/revocation, email verification, recovery and account security.
2. **OtyaPoint owns business authorization:** a verified Otya identity must map to an explicitly provisioned, active OtyaPoint staff membership.
3. **OtyaPoint owns business state:** inventory, stock, sales, staff, ledger, agency and audit changes are accepted only through authorized server-side operations.
4. **The browser gets a secure session boundary:** access credentials must not be placed in browser storage, URLs, logs or client-visible configuration.
5. **Resend remains shared email transport:** identity and security messages are sent server-side using approved templates.

## Current readiness

The product API and business-schema foundations are present, but the dashboard is not yet certified against the replacement Otya session flow and business API. The replacement business system has not yet been provisioned with the first owner or day-to-day records. No live financial-provider write capability is approved.

The legacy application and source data must remain available until export, reconciliation, isolated restore, single-writer cutover and rollback have all been verified.

## Required release sequence

- Establish a protected preview runtime.
- Implement a same-origin server-side session boundary with secure HttpOnly cookies.
- Verify CSRF/origin protection, refresh rotation, logout and revocation.
- Provision staff membership through an audited owner-authorized path.
- Migrate dashboard features one at a time to the product API.
- Verify inventory, stock, cash sales, ledger, audit and staff scopes with synthetic data.
- Rehearse backup restore and rollback.
- Obtain explicit approval before production deployment, remote data changes or provider activation.

Private resource identifiers, routes, bindings, credentials, backup references and exact operational commands must remain in private Otya operations records.

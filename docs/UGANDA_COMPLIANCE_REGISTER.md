# Uganda Compliance Register — OtyaPoint

**Status:** Engineering requirements register, not a legal opinion or a declaration that OtyaPoint is compliant. Confirm applicability with URA, the Personal Data Protection Office (PDPO), the relevant mobile-money providers, and a Ugandan tax/legal adviser before production use.

## 1. Tax invoices and EFRIS

- Determine the actual taxpayer entity, TIN, VAT registration status, business activity classification, and whether any sector/turnover rules require EFRIS for this business.
- URA states that VAT-registered taxpayers must use EFRIS; URA also publishes additional sector requirements and exceptions. Applicability must be checked against the current official guidance for the specific business, not inferred by the app.
- Store invoice state separately from the local retail-sale state. A locally saved receipt must not be represented as a fiscalised EFRIS invoice.
- Save provider-issued invoice identifiers, timestamps, response/status and required fiscal metadata only after validating the official response. Do not fabricate fiscal numbers or claim compliance when offline.
- Support cancellation/adjustment workflows in line with current URA rules; do not silently edit a fiscalised invoice.
- Reference: https://ura.go.ug/en/efris-handbook/ and https://ura.go.ug/en/additional-taxpayers-required-to-use-efris/

## 2. Personal data protection and privacy

- Map the personal data OtyaPoint collects, why it is necessary, the lawful basis, retention period, who can access it, and when it is disclosed to providers or other processors.
- Minimise personal data in customer references, logs, Telegram alerts, exports and provider metadata. Never collect mobile-money PINs or OTPs.
- Implement role-based access, audit trails, secure session handling, data-subject request procedures, incident/breach handling, retention and deletion rules, and vendor/processor reviews.
- Confirm the relevant data-controller/data-collector/processor registration obligations with PDPO and maintain any required registration and compliance reports.
- Review international data processing and transfer arrangements for the selected hosting, email, analytics and notification vendors. Do not assume a cloud region alone proves compliance.
- Reference: https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31 and https://pdpo.go.ug/knowledge-center

## 3. Mobile-money agency and payments

- OtyaPoint is initially an operational recordkeeping system for an authorised agency; it must not present itself as a licensed payment service provider or electronic-money issuer.
- Confirm the agency appointment, permitted services, transaction limits, settlement process, recordkeeping and customer-handling requirements directly with each contracted provider.
- Do not initiate or route real payments until an approved integration route, current API contract, credentials, callback verification, signing/authentication, idempotency and reconciliation procedure are approved.
- A transaction can be marked provider-successful only from a verified provider response or authoritative status check. Ambiguous outcomes must remain pending/unknown and be reconciled; never retry blindly.
- Never store or request customer PINs/OTPs. Protect provider credentials in server-only secret storage, not source control or public environment variables.
- Have counsel/provider compliance confirm whether any proposed OtyaPoint functionality changes the licensing analysis under the National Payment Systems Act, 2020.
- Reference: https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31

## 4. Accounting, audit and reconciliation controls

- Maintain independent retail and fintech-agency ledgers. Never mix retail sales revenue with mobile-money principal/float; record commissions as a separate income category.
- Use integer minor units or carefully controlled decimal arithmetic; avoid JavaScript floating-point arithmetic for money.
- Post each business event atomically with its ledger entries and stock/float movements. Require balanced postings, idempotency, immutable event/audit history and compensating entries for corrections.
- Reconciliation must compare expected versus physically counted cash and provider-reported float/settlement; record differences, reason, preparer, approver and timestamps.
- Apply separation of duties: the preparer cannot approve their own reconciliation; privileged overrides require a reason and audit event.
- Confirm applicable tax/accounting retention and reporting periods with the business accountant and URA. Do not hard-code a retention period until verified.

## 5. Security, availability and hosting

- Keep the production D1 database private to the OtyaPoint Worker service binding. Never expose D1, R2, provider credentials or privileged operations directly to browsers or mobile clients.
- Use Cloudflare Workers for the API, D1 for operational records, private R2 for evidence/backup objects and scoped queues for asynchronous work. Otya Auth remains the identity authority; OtyaPoint must resolve local staff membership, branch, work area and duty on the server for every protected operation.
- Keep staging resources separate from production. Apply version-controlled, additive migrations only after backup, owner-approved record mapping and rollback review. Verify the live migration ledger and table integrity after each production change.
- Configure encrypted D1 exports/backup handling, tested restore procedures, monitoring, incident response and least-privilege Cloudflare access before live financial use. Resend may send notifications but must not be treated as a financial transaction authority.
- Legacy Supabase migrations and references in this repository are historical artifacts only; they are not part of the approved active OtyaPoint Cloudflare-first architecture. Do not create or reconnect a Supabase production project for OtyaPoint without a separate explicit architecture decision.
- Reference: https://developers.cloudflare.com/d1/, https://developers.cloudflare.com/workers/, https://developers.cloudflare.com/r2/

## Production approval checklist

- [ ] Confirm company/legal entity, TIN, VAT status and EFRIS applicability with URA/accountant.
- [ ] Confirm PDPO registration and privacy obligations.
- [ ] Confirm agency agreement, approved API access and requirements with MTN/Airtel or aggregator.
- [ ] Review data processing, cross-border transfers and retention with counsel.
- [ ] Pass schema, authorization, accounting invariant, idempotency, provider-failure and restore tests.
- [ ] Approve hosting plan, backups, monitoring, incident response and production deployment.

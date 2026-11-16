# OtyaPoint — Company Operations Level 1 and 2

**Status:** implementation baseline on feat/company-operations-level-1-2.  
**Scope:** private Otya company operations. This is not a public SaaS, public business-verification network, payment institution, or third-party merchant onboarding service.

## Product decision

Build software for Otya's own company, shops, branches and authorised workers. The first two capability levels are approved:

- **Level 1 — Core company operations:** retail, inventory, branches, staff/workforce, purchasing, suppliers, customers, expenses, internal compliance register, cash/float records, financial reporting and audit.
- **Level 2 — Provider-dependent operations:** separately gated modules for MTN MoMo, Airtel Money, InterSwitch Marketplace Routing, Quickteller Business, EFRIS and approved messaging providers. A module remains unavailable until the company has the required provider appointment, contract, credentials, security controls and legal/regulatory permissions for the exact activity.

Public third-party business verification, external business subscriptions, institutional background checks and third-party financial services are outside this build.

## Existing foundations retained

- Otya Account / Otya Auth remains the shared identity authority.
- OtyaPoint remains the owner of shop, staff, inventory and financial-operation records.
- Otya End remains the shared backend and integration layer; it is not replaced with another backend.
- Retail and agency accounts/ledgers remain separate.
- Existing sale idempotency, stock triggers, audit history, agency cash/float book and Quickteller sandbox status-check tests are preserved.
- The existing Cloudflare D1 migration history is extended additively; no existing data is copied, deleted or silently reassigned.

## New schema foundation in migration 0010

The migration introduces:

- omni_branches: company branches and primary-branch metadata.
- Branch references on existing sales, stock, agency, ledger and reconciliation records. Historical rows remain unassigned (NULL) until an owner-reviewed mapping.
- omni_staff_work_assignments: branch- and work-area-specific permissions. A person can have both RETAIL and MOBILE_MONEY assignments with distinct duty roles. Membership does not itself grant access to every work area.
- omni_customers and omni_suppliers: company-scoped operational contacts. No NIN, biometric or guarantor data is part of this model.
- omni_purchase_orders and omni_purchase_order_lines: supplier purchasing records and receiving quantities.
- omni_expenses: branch-scoped expense records and approval/payment states.
- omni_business_compliance_items: internal register of business/branch licences and provider agreements. Evidence is referenced by a private object key; it is not exposed publicly.
- omni_provider_connections: explicit provider/capability/environment state and recorded approval references. Quickteller Business and InterSwitch Marketplace Routing remain separate provider identities.
- omni_staff_attendance and omni_leave_requests: basic workforce operations without medical diagnoses or medical document uploads.
- omni_branch_stock and append-only omni_branch_stock_movements: branch-level stock foundation. Existing company-wide product quantities are not automatically distributed between branches.

## Security and permission rules

1. Every request must authenticate through Otya Auth and resolve an active OtyaPoint staff membership server-side.
2. Work-area assignment, branch scope, duty role and operation-specific permission must be checked on the server. Do not accept role, branch or company scope from browser-supplied claims.
3. A retail assignment does not grant mobile-money access. A mobile-money assignment does not grant retail stock-adjustment, purchasing or finance-approval access.
4. High-risk actions (expense approval, stock adjustments, purchase submission/receiving, reconciliation approval, staff access changes and provider enablement) require server-side permissions, reason capture and audit events. Dual approval should be used where configured.
5. Customers and supplier contacts are minimal operational data. Do not collect their NINs, selfies, guarantor details or unrelated sensitive information.
6. Compliance document objects must be private, encrypted, access-controlled and subject to retention/deletion rules. The database stores references and metadata, not document bytes or secrets.
7. Provider credentials never enter D1, source control, the browser, logs or mobile apps. Use Cloudflare Secrets Store or the approved server-side secret mechanism.
8. The provider identity and capability must be checked for every request. Do not alias InterSwitch Marketplace Routing as Quickteller Business.
9. A provider timeout or unconfirmed result remains UNKNOWN / pending until independently reconciled. The UI must not claim success optimistically.
10. Production provider writes remain disabled by default. The database gate requires a production environment, active status, provider contract reference, approval evidence reference, approving identity and timestamp before production_write_enabled can be true. This database gate supplements, but does not replace, API authorization and legal/provider approval checks.

## Financial controls

- Store UGX as integer whole-shilling amounts in the Cloudflare D1 operational schema.
- Keep retail and agency cash/float accounting streams distinct.
- Keep transaction, ledger and stock histories append-only; correct mistakes with authorised compensating records, not destructive edits.
- Record expenses separately from provider transactions.
- A purchase order is not proof of receipt or payment. Receiving and payment actions require separate evidence and workflows.
- Never count operator-recorded cash-in/out as provider-confirmed activity.

## Implementation stages

### Stage 1 — schema foundation
- [x] Add the branch, workforce assignment, customer, supplier, purchasing, expense and compliance register tables.
- [x] Add provider/capability/environment approval gates.
- [x] Add branch-level stock movement foundation.
- [x] Add isolated SQLite regression tests for scope, uniqueness, amount validation, stock balances and provider gates.
- [ ] Pass the full GitHub Actions verification workflow.
- [ ] Complete schema/API design review before adding application routes.

### Stage 2 — server APIs
- [ ] Branch setup and branch-scoped query filtering.
- [ ] Work-area assignments, role matrix and permission tests.
- [ ] Customer and supplier CRUD with audit.
- [ ] Purchase order submission, approval, goods receiving and branch-stock posting.
- [ ] Expense submission, approval and payment recording.
- [ ] Attendance and leave workflows.
- [ ] Business compliance document metadata, private upload/download policy and expiry reminders.

### Stage 3 — user interface
- [ ] Replace setup-only dashboard placeholders with real API-backed pages.
- [ ] Retail POS and inventory workflows.
- [ ] Mobile-money operator workspace isolated from retail.
- [ ] Manager and owner finance, purchasing and compliance views.
- [ ] Branch selection and branch-aware reports.
- [ ] Mobile-responsive layouts and accessible loading/empty/error/pending states.

### Stage 4 — Level 2 integrations
- [ ] Verify exact MTN and Airtel agent agreements and approved API capabilities.
- [ ] Keep InterSwitch Marketplace Routing and Quickteller Business separately configured and tested.
- [ ] Add Airtel/MTN provider adapters only after current contracts and API permissions are confirmed.
- [ ] Validate EFRIS requirements and eligible invoice workflow before enabling fiscal submission.
- [ ] Keep SMS/WhatsApp notification delivery independent of payment execution.
- [ ] Sandbox-only testing first; production write switches remain false until all approval gates pass.

### Stage 5 — release readiness
- [ ] Complete CI, static analysis, API tests and end-to-end permission tests.
- [ ] Test backup and restore for the target D1 and private R2 evidence store.
- [ ] Reconcile existing staff, products, stock, provider and branch records; do not infer or auto-assign them.
- [ ] Verify exact legal entity, local trading licence, provider appointment and regulator requirements for each activity.
- [ ] Perform owner-approved staging acceptance and rollback rehearsal.
- [ ] Production migration and deployment require a separate release decision.

## Explicit non-goals and release gates

- No public directory or public verification service for third-party businesses.
- No resale/subscription platform for other businesses.
- No handling or custody of customer funds by Otya software.
- No provider payment initiation until all exact service approvals and contracts are confirmed.
- No live MTN/Airtel/InterSwitch/Quickteller transactions from this schema migration.
- No remote D1 migration, Cloudflare deployment, DNS change, secret rotation, data deletion or production permission change as part of the pull request.

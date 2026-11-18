# Otya Enterprise — corporate management and operations blueprint

**Status:** Architecture baseline for the staged rebuild. This document does not certify production readiness or provider approval.

## Product direction

Otya Enterprise is the company operating system for the Otya business: company identity, workforce, outlets, provider relationships, company equipment, retail, records, reconciliation, approvals and governance.

The existing OPoint repository slug is retained during migration to preserve history and open pull requests. The business operations backend in this repository becomes the first implementation base for Otya Enterprise. Public labels and navigation should use the approved Otya Enterprise brand once the interface is ready.

**Omy Play is explicitly out of scope.** Do not modify its source repository, Android application, Firebase project, Cloudflare resources, R2 buckets, release process, signing keys, user data or local-first behavior as part of this rebuild.

## System ownership

| Capability | Owner | Rule |
|---|---|---|
| Global Otya identity and authentication | Otya Auth in Otya End | Share only a verified identity subject and safe profile claims |
| Company, legal entity, branches and outlets | Otya Enterprise | The company and branch hierarchy is the business source of truth |
| Employment and assignments | Otya Enterprise | An employee identity is distinct from a job, outlet assignment and permission grant |
| Provider corporate relationships and IDs | Otya Enterprise | One parent relationship per company/provider, with separate outlet accounts below it |
| Provider payment execution | Airtel, MTN, Interswitch official systems | Otya does not initiate or execute customer/provider payments |
| Provider transaction and balance evidence | Otya Enterprise records | Store source, timestamp and evidence level; never invent live or confirmed status |
| Company cash, float records and accounting | Otya Enterprise | Separate provider float, till cash, retail cash, commissions and company operating accounts |
| Products, stock and retail sales | Otya Enterprise | Catalogue, barcode, IMEI/serial, purchasing, sales, warranties and returns |
| Documents and evidence | Otya Enterprise with private R2 storage | D1 stores metadata; private objects live in R2 |
| Shared transactional email | Otya End / Resend | Product services use narrow authenticated service contracts |

## Corporate hierarchy

The canonical business hierarchy is:

Legal company → provider relationship → branch/outlet → provider outlet account → approved teller/operator → assigned company SIM/device.

A provider relationship is unique per company and provider. The provider's corporate/parent agent reference is stored once on that relationship. Each outlet can have a separate provider account reference and float account. Company-level commission or settlement accounts can be represented separately from outlet-level accounts.

A company ID in Otya is not a provider-issued agent ID. Provider-issued identifiers must be copied only from approved provider documentation.

## Identity and authorization

- One Otya identity can have one employee profile per company.
- One employee can hold multiple employment assignments, such as retail cashier and Airtel teller, possibly at different outlets or shifts.
- Provider operator profiles are separate from Otya job positions and never contain provider passwords, PINs or secret credentials.
- Access is deny-by-default and checked on every server request.
- Every access decision combines the employee membership, active assignment, role/permission grant, outlet scope, provider-account scope and status.
- A UI that hides a button is not an authorization boundary.
- HR, finance, provider accounts and personal records receive separate permissions.
- Managers see only their assigned scope; employees see their own profile and assigned operations; company administrators receive approved cross-outlet reporting.
- Sensitive changes require a different approver from the creator where practical. Audit history is append-oriented.

## No payment-processing engine

The platform records business activity and financial evidence; it is not a payment switch, wallet, aggregator or provider execution engine.

Explicitly excluded:
- cash-in/cash-out initiation;
- mobile-money transfers and bill-payment execution;
- airtime/data purchase execution;
- provider wallet creation or custody;
- provider PIN/password storage;
- provider API calls that move money;
- pretending a manually keyed transaction succeeded.

Allowed:
- recording a transaction completed in an official provider application;
- capturing its provider reference and receipt evidence;
- importing official statements/reports;
- read-only balance or transaction feeds where a provider expressly authorizes them;
- internal cash/float book-keeping and reconciliation;
- company accounting for completed sales, expenses, commissions and adjustments.

The accounting ledger is an internal book of record, not an external payment-processing ledger. A balance observation always carries a source and observation time. An imported or manually entered value must never be presented as a live provider balance.

## Data capture and automation

The server derives employee identity, company, outlet, permissions, selected provider account, registered device and server timestamp from the authenticated session and current assignments. Staff should not retype these fields.

Preferred capture methods:
1. camera barcode/QR/IMEI scanning for products, phones and assets;
2. pre-registered staff/device/SIM QR labels for assignment and handover;
3. receipt photograph or QR extraction into a review queue;
4. explicitly shared provider SMS text, screenshots and official statement imports;
5. provider-approved read-only data/report feeds where offered;
6. short manual-exception forms only when no reliable digital source exists.

OCR or AI extraction creates proposed data, not authoritative data. A human must confirm uncertain fields before issuing a receipt or treating a provider transaction as reconciled. The application must not scrape private screens or databases of Airtel, MTN or Quickteller apps.

## Platform and repository boundaries

- GitHub organization OtyaHQ remains the source of code and review.
- Cloudflare Workers is the API/runtime layer.
- D1 is the authoritative company operational database.
- R2 stores private evidence and documents; access uses short-lived, authorized URLs.
- Queues handle retryable background imports, notifications and report generation.
- Workflows handle onboarding, approvals, scheduled reviews and offboarding.
- Otya Auth remains the shared identity service.
- Resend remains the transactional email provider.
- Firebase is not a financial source of truth. Use it only for approved mobile notifications/diagnostics if a mobile client needs it.
- Do not introduce Supabase, Appwrite, Vercel or AWS as new production dependencies for this product.

Do not put Enterprise business tables into Otya End's media database. Do not create a new Worker/database for every module. The business platform should begin as one modular API and one product-owned D1 database.

## Rebuild phases

### Phase 0 — audit and safe foundation
- inventory repositories, workflows, dependencies, Cloudflare resources and active routes;
- retain Omy Play unchanged;
- define canonical company/outlet/employee/provider model;
- create forward-only schema migrations and automated tests;
- keep all current production resources untouched.

### Phase 1 — organization and access
- company/legal entity profile, branches/outlets, departments and positions;
- employee profiles, multiple assignments, access grants and approvals;
- shared Otya Auth session with company-specific authorization;
- management and staff experiences with one login.

### Phase 2 — provider and asset registry
- corporate parent provider relationship;
- separate provider outlet accounts and company-level commission/settlement accounts;
- approved teller profiles;
- company SIMs, devices, terminals and assignment history;
- balance observations and statement-import intake.

### Phase 3 — automated work
- barcode, QR, IMEI and receipt capture;
- statement parsers and duplicate detection;
- explicitly shared message intake and provider-specific parsing;
- leave, attendance, shifts, tasks and approvals;
- queue/workflow orchestration and exception handling.

### Phase 4 — retail and accounting
- products, variants, serial/IMEI, purchasing, stock, sales, warranty and returns;
- distinct retail cash, agency cash, provider float, commissions and company expenses;
- Otya-issued sales and agency service receipts;
- reconciliation, approved adjustments and audit evidence.

### Phase 5 — governance and scale
- company compliance, documents, training and risk controls;
- management reports, outlet comparisons and periodic access reviews;
- pilot at one outlet, then expand only after acceptance tests.

## Acceptance gates

No feature is called production-ready until:
- its schema and migration tests pass;
- every sensitive route verifies identity and company/outlet scope server-side;
- duplicate imports and retries are safe;
- staff cannot see another staff member's restricted information;
- a manually recorded transaction cannot claim provider confirmation;
- private files cannot be accessed by guessing an object key;
- correction/approval history is preserved;
- backups can be restored in an isolated environment;
- the user experience has been tested on a small Android phone;
- live provider activation has separate written provider approval.

## Cleanup and retirement policy

"Remove what is not needed" means remove verified dead code and duplicate dependencies, not delete resources by name alone.

Before deleting a repository, Worker, database, bucket, queue, secret, DNS record, branch, package or Firebase project:
1. identify all current code references and runtime bindings;
2. check traffic, jobs, schedules, webhooks and dependent products;
3. export and verify any data that must be retained;
4. confirm a tested replacement exists;
5. remove the old dependency in a reviewable change;
6. observe the replacement before retiring the old resource.

Never remove or change Omy Play resources under this project.

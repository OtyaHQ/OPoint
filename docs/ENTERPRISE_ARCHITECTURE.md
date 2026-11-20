# Otya Enterprise backend architecture

**Status:** v1 architecture foundation; implementation in progress  
**Repository:** OtyaHQ/OPoint  
**Runtime:** Cloudflare Workers + D1 + R2 + Queues/Workflows  
**Shared identity:** Otya Auth in Otya End  
**Out of scope:** payment execution, provider wallet creation, provider PIN handling, and replacing official provider apps.

## Product and repository boundaries

- Otya End remains the shared identity and common ecosystem-services layer. Its media-specific database is not the company database.
- OPoint is the business operations backend being expanded into the first Otya Enterprise operations domain: outlets, staff, provider relationships, company assets, retail, agency records, finance operations, receipts and reconciliation.
- Omy Play is preserved. No changes to its code, database or release pipeline are part of this work.
- OHub remains public developer/partner documentation.
- Other repositories and legacy resources must be inventoried before deletion. No production resource is removed merely to make names look clean.

## Target runtime

1. One Cloudflare Worker exposes the Otya Enterprise business API.
2. D1 stores structured company and operational records.
3. R2 stores private provider receipt images, statements, corporate documents and uploaded evidence; D1 stores metadata and object keys only. The existing `opoint-private-documents` bucket is bound as `PRIVATE_FILES` and has no public domain configured.
4. Queues handle slow file parsing, statement import and notification work.
5. Workflows handle employee onboarding/offboarding, approvals and multi-step reviews.
6. Otya Auth verifies user identity. OPoint applies business membership, outlet assignments and specific permissions.
7. Resend delivers company email notifications through the existing shared Otya service.

Do not create a Worker or database for each module. Keep a modular monolith until a real security, load or operational reason requires service separation.

## Company and access model

The hierarchy is: company → provider relationships → outlets → provider outlet accounts → named provider operators.

An employee has one Otya identity and one company employment record, but can have multiple role and outlet assignments. Provider operator identities are separate mappings per provider. SIMs and devices are company assets assigned through dated custody records.

Authorization is deny-by-default. Every request must check active identity and company membership, permission key, outlet/provider-account scope, employee assignment and employment status, plus approval requirements for sensitive actions. Hiding a screen in the frontend is not authorization. Never trust a role, company ID, outlet ID, employee ID or provider account scope simply because the client submitted it.

## Provider account model

For each provider, store one corporate parent relationship, its common company-level agent identity, and separate provider-specific outlet account records. Each outlet account may have its own external outlet/till/float reference. Each approved employee operator maps to the provider account and outlet they are authorised to use.

Provider identifiers must be recorded exactly as issued. An Otya internal ID is not represented as a provider-issued number. Parent IDs, outlet IDs, teller IDs, MSISDNs and internal asset tags are distinct.

The model supports AIRTEL_MONEY, MTN_MOMO and INTERSWITCH_QUICKTELLER. This schema capability does not prove any provider has approved a parent/child account structure. Provider agreement and account IDs are populated only from provider-issued documents or portals.

## Financial-record model

Keep retail cash, agency cash, Airtel float, MTN float, Interswitch/Quickteller balance, commission settlement, expenses and company bank accounts separate.

An outlet book balance is Otya's own record. A provider balance is an observation from a provider portal, official statement, authorised read-only feed, or explicitly labelled manual entry. Never present a book balance or staff-entered amount as a live provider balance.

All amounts are whole UGX integers. Transaction records and ledger movements are append-only; corrections use compensating records with reasons and approvals.

## Receipt model

- Retail receipts are generated from a committed Otya retail sale and its line-item snapshots.
- Tax invoices are labelled fiscal/EFRIS-compliant only after required URA setup and successful official fiscalisation.
- Mobile-money customer acknowledgements are supplemental company records. They show provider, reference, outlet, amount, issue time and a visible statement that the provider's official receipt/confirmation remains authoritative.
- A message-parsed status is not independently verified provider status. It remains a source claim until matched to an official provider report or approved read-only feed.

## Automated evidence capture

1. Staff explicitly shares message text to Otya, or uploads a provider receipt, screenshot or statement.
2. Parsing produces a minimal candidate: provider, amount, reference, transaction type and source-claimed status.
3. Raw SMS text is not stored by the generic parser. Full uploaded evidence is private in R2 only when needed, with access and retention controls.
4. Duplicate detection and confidence scoring run before review.
5. The submitter checks the candidate; a different authorised person reviews exceptions or sensitive records.
6. Accepted data creates an Otya transaction record labelled operator-reviewed, not provider-confirmed.
7. Official statements or approved read-only feeds can later produce separate verification events.

Do not silently read every SMS, notification, contact or private app. Do not use notification access as a workaround for SMS restrictions. Prefer explicit Android share/import, file uploads and provider statement exports. Evaluate native Android integration only after documented privacy and distribution-policy review.

## Release and cleanup rules

- Work in feature branches and reviewable pull requests.
- Test migrations against a fresh local D1 and the current migration chain.
- Back up and verify restore before production data migration.
- Existing company-level agency accounts and movements are legacy records. Do not delete them. New outlet-aware records coexist until a separately reviewed migration maps existing balances and movements.
- Audit OEnd, OPoint, OHub and legacy O repositories before removal. Omy Play remains untouched.


## Current API implementation boundary

The first backend tranche includes same-origin Otya Auth session endpoints with Secure/HttpOnly/SameSite cookies, active company staff membership checks, outlet/provider relationship setup, private R2 file upload/download, explicit selected-message ingestion and second-person evidence review, company profile, and snapshot receipt endpoints. The permission-grant tables exist, but all existing business routes are not yet migrated to permission-key evaluation. The new file upload path marks images/statements as uploaded and awaiting extraction; it does not yet run OCR or statement parsing. Receipt endpoints return structured snapshots; a printable/PDF renderer is still pending. These paths are source-code changes on the feature branch and are not live until the full release gates pass.

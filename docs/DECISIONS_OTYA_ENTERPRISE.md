# Decision log — Otya Enterprise rebuild

## Approved product boundary

Otya Enterprise is the corporate management and operations system. Omy Play is protected and excluded from this rebuild.

## Approved provider boundary

Airtel, MTN and Interswitch retain responsibility for execution of provider transactions. Otya Enterprise records company/operator/outlet information, transaction references, receipts, evidence, balances observed from approved sources, reconciliations and reports. Do not build payment-initiation, wallet, transfer, deposit, withdrawal, bill-payment or airtime/data execution APIs into this product.

## Approved corporate structure

- One Otya company identity and one parent provider relationship per provider, subject to each provider contract.
- Separate provider outlet account records and balances under the relationship.
- Separate teller/operator identity records for every approved employee.
- Company SIMs/devices are separate asset records and are assigned to people and outlets.
- The exact provider-issued parent/outlet/operator identifiers are only populated from written provider approval.

## Approved automation approach

- Derive user, employee, outlet, device, assignments, permissions and server timestamps from signed-in context.
- Scan barcodes, QR codes, IMEIs and asset tags.
- Import provider statements and reports with duplicate detection.
- Receive a selected SMS or screenshot only through an explicit Android share action or approved provider data feed.
- Do not request broad SMS inbox permissions or use notification access to bypass Google Play SMS restrictions.
- Keep raw message content out of D1 by default; store minimal normalized fields and evidence references.
- OCR/parser outputs require review where confidence is low or source authenticity is not established.

## Receipt policy

- Retail receipts are generated from completed sale records and stored as immutable snapshots.
- Agency service receipts are generated from recorded provider transactions and include the provider reference and evidence/status as known at issue time.
- An Otya receipt is not presented as a provider receipt.
- An Otya receipt is not an EFRIS fiscal tax invoice unless the applicable URA process has actually been completed.
- Corrections and voids are auditable; original issued snapshots are retained.

## Data and platform

- Otya Auth remains the shared identity service.
- Otya Enterprise D1 is the authoritative company operations database.
- R2 stores private uploaded evidence/documents.
- Workers host the API; Queues and Workflows handle background imports and business approvals.
- Resend is used for transactional email.
- Do not introduce Supabase, Appwrite, Vercel or AWS as new dependencies for this product.
- Do not store company records in Omy Play databases or media app services.

## Cleanup policy

Remove dead code and dependencies only after verifying there are no active imports, routes, runtime bindings, jobs, DNS references, provider dependencies or data-retention obligations. Production databases, Workers, secrets, buckets, queues, Firebase projects, DNS records and Omy Play assets are not deleted as part of a feature-branch rebuild.
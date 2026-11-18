# Automated data capture — Otya Enterprise

## Objective

Workers should not be asked to repeatedly type information Otya already knows or can reliably scan/import. The platform pre-fills context and captures evidence; humans only confirm ambiguous or business-critical facts.

## 1. Automatic session context

After login the API resolves:
- authenticated Otya identity subject;
- active company membership and employee profile;
- current/assigned outlet and department;
- active shift and assigned duties, if enabled;
- permitted provider relationships and outlet accounts;
- approved provider operator profile;
- assigned company SIM and device;
- server-generated time, request ID and audit actor.

These values are not trusted when sent by the browser. The server loads them from its own records.

A worker must not type their name, employee ID, outlet, manager, provider identity, device ID or transaction date on every transaction.

## 2. Retail capture

- Scan a product barcode/QR and resolve it to an existing SKU.
- For an unknown code, show a short "register product" workflow to an authorized stock controller.
- Capture phone IMEI/serial from the device label using the camera; validate format and duplicate use.
- Product, price and permitted discount are loaded from the server catalogue. Cost price is hidden from counter roles.
- Completing an approved sale creates the receipt and stock movement atomically; returns use a linked return record, not a silent quantity edit.
- Bulk supplier lists are imported using a validated CSV/XLSX template instead of line-by-line typing.

A barcode scan is a lookup key, not proof that the item is genuine or owned by the company.

## 3. Provider operation capture

The customer transaction happens only in the provider's official application/terminal.

Afterward Otya can capture data using this priority:
1. provider-approved webhook or read-only transaction/status feed;
2. official statement/CSV/XLSX report import;
3. explicitly share a selected provider SMS text from the Messages app into Otya;
4. share a provider receipt screenshot or file into Otya;
5. minimal manual exception entry.

The API automatically binds the employee, outlet, approved operator profile, provider outlet account and timestamp. Staff should only confirm the provider reference, transaction type and amount if no approved data source supplied them.

A provider app's private storage, login session and PIN must not be accessed, intercepted, screen-scraped or stored by Otya.

## 4. Provider SMS capture

The first implementation should use Android's explicit Share flow rather than broad SMS inbox access.

- The employee opens the specific Airtel, MTN or Interswitch transaction message.
- The employee uses Android Share and selects Otya Enterprise.
- Otya receives only the selected text or screenshot.
- The app matches the sender/provider and parses transaction reference, type, amount, date, fee/commission and account hints where present.
- The system fills employee, outlet, registered device and assigned provider account from the authenticated session.
- Duplicate messages are detected using a keyed/hashed fingerprint and provider reference.
- A review screen shows extracted fields and confidence; the employee confirms uncertain details.
- The platform stores the normalized fields and evidence metadata. It does not retain the whole SMS body by default.
- The captured SMS is evidence, not a cryptographically authenticated provider statement. It must not by itself make a transaction "provider verified" or a balance "live".

For production Play distribution, do not request READ_SMS or RECEIVE_SMS just to harvest transaction messages. Google Play strictly limits those permissions to approved default SMS/Assistant handling or specific reviewed exceptions. Do not use notification access as a workaround for those restrictions. Any future automatic device-message capture requires a separate policy, privacy and legal review, employee notice, explicit opt-in and a demonstrated approved technical path.

## 5. Receipt and document extraction

An uploaded image/PDF is stored privately in R2; D1 keeps the object ID, checksum, classification and processing state.

An extraction job may propose:
- provider;
- provider transaction reference;
- amount/currency;
- transaction type;
- transaction date/time;
- commission, when present;
- outlet/account hint.

The extraction stores parser/model version, per-field confidence and source evidence. It does not create a provider-confirmed transaction by itself. Low-confidence or conflicting fields go to a review queue. A user with the correct permission confirms or rejects the proposed values.

Never make a balance or success claim from an unreviewed OCR result.

## 6. Provider statement imports

1. The employee selects an already registered provider outlet account.
2. The platform accepts a permitted CSV/XLSX/PDF report and stores the original privately.
3. It computes a SHA-256 checksum and checks for duplicate uploads.
4. A provider-specific parser converts rows into a common normalized format.
5. Validation detects missing references, malformed amounts, dates outside the statement period and duplicate references.
6. Rows are staged for review; they are not automatically treated as settled cash.
7. An authorized manager/accountant accepts the batch.
8. Matching compares provider references, amounts, dates, operator accounts and existing recorded operations.
9. Matched, unmatched, duplicated and disputed rows remain separately reportable.

CSV column order and number formats vary. Parsers are versioned and provider-specific; a failed parser must not silently discard rows.

## 7. Balance collection

Each balance entry is an immutable observation with:
- provider outlet account;
- balance type (available float, commission or settlement);
- amount and currency;
- provider/local observation time;
- data source (provider portal, statement, approved read-only feed or staff attestation);
- evidence file/reference;
- recording employee and ingestion job.

The dashboard displays the amount plus "as of" timestamp and source. It distinguishes provider-reported, system-imported and staff-reported values. It never labels a stale value "live."

## 8. Company receipt generation

### Retail
Scanning a product populates the sale with its catalogue description, SKU, current authorized price and available stock. A completed sale creates its own Otya receipt number and immutable receipt snapshot. The cashier does not type their name, outlet, date or product details repeatedly.

A sale receipt is created only after the sale is completed and its payment/settlement status is recorded according to the approved workflow. Printing or sharing the receipt is a separate action.

### Mobile-money agency services
After the transaction is performed in the provider's official app/terminal, Otya captures the provider reference and available evidence. It can then issue an Otya agency-service receipt/acknowledgement containing the provider, outlet, employee/teller, transaction type, amount, date, Otya receipt number and provider reference.

The wording must reflect the evidence level:
- staff record only: "Recorded by Otya; provider confirmation pending";
- message or image reviewed: "Provider message/receipt evidence captured; not statement-verified";
- official provider statement matched or authorized provider feed: "Matched to provider report".

An Otya receipt is the company's record. It is not the provider-generated receipt and does not automatically constitute an EFRIS fiscal tax invoice. Any tax invoice must follow the company's applicable URA/EFRIS requirements.

Receipts are immutable after issue. Corrections create a void/replacement record with a reason and audit trail; they do not overwrite history.

## 9. SIM/device automation

- Scan the company asset tag, device QR, IMEI, SIM ICCID or printed serial.
- Resolve the company asset and its current custody record.
- Issue/return requires employee and manager acknowledgement for restricted assets.
- Changing employee/outlet assignments creates a new history record; it does not overwrite the prior custody trail.
- Lost/stolen/repair/retired devices are marked immediately and access is reviewed.
- Do not store SIM PIN, PUK, provider app PIN, device passcode or biometric template.

## 10. Attendance and workplace automation

Attendance can use an employee QR, an approved managed-device check-in or manager confirmation. GPS is not required by default. If location proof is ever introduced, it must be justified, disclosed and separately permissioned.

Shifts, leave and tasks use workflows:
- scheduled shift → assigned employee notification;
- check-in/check-out → attendance record;
- leave request → manager approval;
- task assignment → staff notification → evidence/completion;
- offboarding → access suspension, asset/SIM recovery, cash/float handover and records retention.

## 11. Automation reliability

- Use idempotency keys for uploads, import batches and transaction references.
- Keep raw source files and parsed records separate.
- Do not overwrite a source statement or employee-entered record; create a correction or review decision.
- Retry transient jobs through Queues; send exhausted work to a dead-letter queue with an owner-visible exception.
- Use Workflows for multi-stage onboarding, approval, reconciliation and offboarding.
- Every automated action records the actor/source, code or parser version, request/job ID and result.

## 12. Manual entry is the exception path

When no scan or approved data source exists, show a short form that asks only for indispensable fields. Derive all other data from the authenticated employee and outlet context. Explain why manual entry is required and let the employee attach evidence.

The goal is not zero human input. The goal is to eliminate repeated typing while retaining human confirmation for uncertain evidence, cash counts, approvals and exceptions.

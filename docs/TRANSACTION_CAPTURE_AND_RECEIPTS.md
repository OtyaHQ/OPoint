# Otya Enterprise transaction capture and customer receipts

## Objective

Reduce repeated employee typing while keeping the provider as the payment execution and authoritative transaction system. Otya records, organises, reconciles and issues clearly labelled company documents.

## Capture channels

### Explicit message sharing
A staff member opens a provider SMS, selects Share, and sends that selected message to Otya Staff. The app parses only the selected text and asks the worker to confirm the proposed outlet/account. The generic parser does not retain the raw message.

### Provider receipt image
Staff use the app's camera or gallery picker to upload a provider receipt. A document parser/OCR worker extracts candidate data. The app presents the amount and reference for confirmation. Original images are kept privately only according to the business-record retention policy.

### Provider statements and exports
Managers upload an official CSV, spreadsheet or PDF statement from the provider portal. Import jobs validate the format, deduplicate references and match records to the correct outlet account. Statement rows can create verification events after review.

### Provider reporting/read-only feed
If a provider offers an approved read-only balance/statement interface or reporting feed, connect it separately. Do not use credentials for transaction initiation. A provider dashboard can remain the source, with controlled statement import into Otya.

### Manual correction
A worker may correct an incomplete parse, but Otya stores the editor, reason and review history. Do not require the worker to retype fields already extracted.

## Not allowed by default

- Broad background reading of every SMS inbox.
- Uploading all personal messages or all app notifications.
- Reading provider PINs, OTPs, password reset codes or customer conversations.
- Using Accessibility Services to scrape provider applications.
- Marking a transaction successful only because a user pasted text or uploaded an image.
- Calling payment-initiation, cash-in, cash-out, float-transfer or bill-payment execution endpoints from Otya.

Google Play restricts SMS/Call Log permissions. SMS-based financial transaction and money-management use cases may qualify for an exception, but this is subject to Google review and declaration; it is not automatic. Notification access must not be used as a workaround to obtain SMS content. Any future Android integration needs a privacy review and store-policy assessment.

## Parse and verification states

The parser returns provider selected by the user, transaction type candidate, UGX amount, provider reference, source status claim, parser version and confidence. It always returns requiresHumanReview=true, verificationLevel=UNVERIFIED and providerConfirmed=false.

After a second authorised review, the record may become OPERATOR_REVIEWED. Only a matching official provider statement or authorised read-only provider feed can move its verification level to STATEMENT_MATCHED or READ_ONLY_PROVIDER_CONFIRMED.

## Receipt types

### Retail sales receipt
Generated from a committed retail sale. Includes company/outlet details, receipt number, timestamp, product/SKU/quantity/unit price, total, payment method and return/warranty terms. EFRIS/fiscal invoice data is separate. Do not label a general receipt as an EFRIS tax invoice unless official fiscalisation has succeeded.

### Agency service acknowledgement
A supplemental company record for a provider transaction. Includes provider, outlet, Otya employee/operator, amount, transaction type, provider reference, evidence source and verification label. It must say that it is an Otya company acknowledgement and not a replacement for the official provider receipt/confirmation.

## Customer and worker flow

1. Provider transaction is completed in the official provider application/terminal.
2. The customer receives the provider's official confirmation.
3. Staff shares the relevant message or scans/uploads the provider receipt.
4. Otya extracts candidate fields and flags uncertainty/duplicates.
5. Staff confirms outlet/account; an authorised reviewer resolves exceptions.
6. Otya records the event and can issue the appropriate supplemental acknowledgement.
7. Daily reconciliation compares Otya records with provider statements, cash drawers and float records.

## Receipt delivery

The system should render a printer-friendly HTML receipt and a PDF copy stored in private R2. Staff can print to a supported receipt printer or share a customer copy. No provider PIN or private customer message history appears on the receipt.

# OtyaPoint provider evidence and receipt foundation

**Status:** schema foundation in review; not a deployed workflow.

## Purpose

Record provider evidence for Otya's own authorised agency operations without treating an SMS, screenshot, statement row or staff report as proof that a payment completed. Keep provider evidence, operator records, provider-confirmed status and accounting receipts distinct.

## Approved evidence sources

The schema accepts evidence categories such as:
- A provider message explicitly shared by an authorised worker.
- A screenshot/file explicitly uploaded by an authorised worker.
- A provider-issued statement/report imported by an authorised owner or operator.

The mobile app must not request general SMS inbox permissions, notification-listener access or provider app credentials for this feature. There is no background reading of personal messages.

## Parsing and human review

The parser accepts supported provider identities (Airtel Money, MTN MoMo and InterSwitch/Quickteller as distinct identities) and extracts only candidates such as transaction reference, amount, transaction kind and wording-claimed status.

The parser's authoritative result is always `providerStatus: UNKNOWN`. A message that says “successful” remains a message claim. It does not become provider-confirmed success and must not automatically post a sale, cash movement, commission or ledger entry.

An eventual review workflow must:
1. Verify the authenticated company membership, branch, work area and duty role.
2. Preserve the source fingerprint and private evidence-file reference.
3. Show parsed candidates beside the original, user-shared evidence where policy permits.
4. Mark uncertain/incomplete/duplicate content for manual review.
5. Reconcile against a trusted provider API or official statement before elevating the evidence level.
6. Record the reviewer, reason, source, reconciliation reference and status history.

## Receipts

An issued receipt snapshots the source record, currency/amount, provider status and evidence level at the moment of issuance. Receipt verification must never expose private employee or customer data. Issued receipts are retained; voiding is an explicit, authorized and audited state transition with a reason.

## Separation from financial execution

These tables do not initiate Airtel, MTN, InterSwitch or Quickteller transactions. They do not call provider payment endpoints, change provider balances, post cash movements or enable bill/airtime execution. Real-money provider actions remain disabled pending contracts, approvals, callback verification, idempotency, reconciliation, recovery and Uganda compliance review.

## Current implementation boundary

Migrations 0005 and 0006 add the database foundation and integrity triggers. The parser is a pure helper with synthetic contract tests. HTTP capture, file upload, human review, statement import, receipt issuance UI/API, retention/void workflows and end-to-end staging acceptance remain to be implemented.

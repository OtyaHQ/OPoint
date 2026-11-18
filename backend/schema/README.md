# Otya Enterprise D1 schema

This database is the authoritative operational store for the company-management and retail/agency-records product. The initial schema snapshot is the pre-Enterprise base. It is not a migration for an existing database.

## Migration order

1. Existing isolated staging bootstrap: backend/schema/bootstrap.sql.
2. Existing migration history: 0001_opoint_core, 0002_operational_hardening, 0003_financial_integrity_guards.
3. 0004_enterprise_automation.sql — departments, employee profiles/assignments/permission grants, documents, company assets and SIMs, parent provider relationships, outlet accounts, operator profiles, balance observations, capture records and statement imports.
4. 0005_message_capture_and_receipts.sql — explicitly shared provider-message evidence, company-issued retail/agency receipts and receipt history.

The numbered files in backend/schema/migrations are forward-only. Never apply bootstrap.sql to a database that already contains application or migration data.

## Important boundaries

- Omy Play has its own database and is not part of this schema.
- D1 stores company operational records, not provider PINs, passwords, PUKs, authentication secrets or payment credentials.
- Provider payments are executed in provider-approved systems, not by this product.
- Provider balance records are observations with a source and timestamp, not a live wallet balance unless supplied by an approved feed.
- Message capture stores parsed candidate fields and a one-way fingerprint. It does not store the full raw SMS body in D1.
- Issued receipts preserve a snapshot and evidence/status at issue time. A company receipt is not a provider-generated receipt and does not automatically qualify as an EFRIS fiscal invoice.

## Validation

Run from the repository root:

    npm --prefix backend run verify:schema

The verifier applies the base snapshot and Enterprise migrations to an in-memory SQLite database, checks integrity and foreign keys, and exercises multiple outlets, provider accounts, operator mappings, balance evidence, explicit message capture and receipt issuance.

## Staging and production

The new migrations are code only until explicitly applied to the isolated staging D1 database using the approved Cloudflare release workflow. Do not deploy them to production, change live bindings or retire the legacy database as part of this PR.
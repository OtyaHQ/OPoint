# OtyaPoint data and cutover principles

## Decision

OtyaPoint owns its shop and agency business data. Otya Auth provides shared identity, while OtyaPoint grants product-specific access through explicit staff authorization. Cloud services provide the server-side runtime and data platform; Resend remains the shared transactional email provider.

Do not add a duplicate database or second active writer for a capability already owned by an existing Otya service without a concrete isolation or scaling reason.

## Data ownership

- Account identity remains shared across the Otya ecosystem.
- Product, inventory, staff membership, cash sale, ledger and agency records remain OtyaPoint-owned.
- AI, media, website and other product services must not write directly into OtyaPoint business records.
- Financial history is append-only; corrections use compensating records rather than silently editing prior transactions.
- Retail cash and agency cash/float/settlement/commission records remain separate.

## Migration and cutover

1. Inventory all existing data sources and active imports.
2. Export using an approved, protected process.
3. Reconcile row counts, monetary totals and identifiers.
4. Restore into an isolated verification environment.
5. Test authentication, authorization, company/branch scope, inventory, sales, ledger and audit behavior.
6. Fence the old writer before enabling the new writer.
7. Test rollback and recovery before production cutover.
8. Retire legacy code or data only after a separate review confirms it is no longer required.

Do not expose private resource names, account IDs, backup locations or hashes in public documentation. Keep operational cutover records in a private Otya workspace.

## Current readiness

The replacement API foundations exist, but the dashboard's Otya session bridge and business-data cutover have not passed end-to-end acceptance. The replacement business system has not yet been provisioned with the first owner or daily operating records. Live provider writes remain disabled.

## Technology constraints

Keep Cloudflare as the preferred runtime, GitHub as source control and Resend as shared transactional email. Do not introduce Supabase, Appwrite or Vercel into the target runtime without explicit owner approval. Preserve existing data and compatibility until migration and recovery gates are complete.

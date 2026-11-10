# OtyaPoint — Public deployment and operations status

**Last reviewed:** 2026-11-09  
**Audience:** customers, developers and integration partners  
**Classification:** public-safe product status only

This repository is public. It must not be used as an inventory of private infrastructure. Exact account/resource IDs, database names, bucket names, backup object paths, object hashes, access policies, private routes, tenant records and internal service bindings belong in the owner's private operations records, not in public product documentation.

## Current product status

- **Application:** OtyaPoint is the public product name for the shop and business-operations experience.
- **Backend source:** the Cloudflare API implementation and versioned D1 migration files are maintained in this repository.
- **Deployment:** the private `otyapoint-api` Worker has a published Cloudflare deployment. It is not customer-facing: `workers_dev` is disabled and no public route or custom domain is attached. The Worker deployment does not certify dashboard connectivity. Source code and a successful build do not establish a live deployment.
- **Data migration:** production D1 migrations `0001–0009` are applied. At the 2026-11-10 inspection, all 13 OtyaPoint business tables were empty. The existing dashboard still has a legacy authentication/data path; it must remain intact until the replacement session boundary, data export, reconciliation and restore process are verified.
- **Retail:** the source contains authenticated catalogue, stock and cash-only retail sale foundations. The private API Worker exists, but the dashboard is not yet fully connected to it; no owner bootstrap, products, staff memberships or sales were present in the inspected business tables.
- **Agency providers:** Interswitch Marketplace Routing, Quickteller Business, Airtel Money and MTN Mobile Money remain separate integrations and are not marked ready for real-money execution. Transaction creation stays disabled until each provider contract, credentials, callbacks, idempotency, reconciliation and financial controls are independently approved.
- **Email:** Otya uses its shared transactional email service. Source-level service-binding routes must not be described as operational until the paired service credentials and live deployment are verified.

## Public integration guidance

- Product data remains within the owning product's authorization boundary.
- Authenticate and authorize every request on the server; a shared identity alone does not grant access to shop records.
- Keep privileged service credentials server-side and use narrow service scopes.
- Use idempotency keys for writes and immutable records for financial/audit history.
- Treat provider timeouts as pending or unknown until reconciled with trusted provider evidence.
- Never publish customer data, transaction references, private logs, backup files or operational credentials.

## Operator-only records

The detailed infrastructure inventory, resource identifiers, backup manifests, data row counts, access configuration and recovery evidence are intentionally excluded from this public repository. They must be maintained in a private owner-controlled operations system with restricted access and a verified backup/restore process.

This public status page does not authorize production deployment, remote database migration, DNS or secret changes, resource deletion, provider activation or financial operations.

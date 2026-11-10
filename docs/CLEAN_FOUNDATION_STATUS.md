# OtyaPoint foundation history — legacy development baseline

**Product:** OtyaPoint, the retail and mobile-money agency operations product in the Otya ecosystem.

**Parent-entity status:** Otya Holdings Limited is the intended parent entity; URSB registration is in progress. Until incorporation and formal provider re-verification are complete, individual merchant and payment-provider accounts remain in the verified account holder's legal name. Otya and OtyaPoint are product/brand identities and must not be presented as a registered company or as the legal merchant.

**Document status:** This file records an earlier isolated development baseline. It is not the current production status; see `docs/production-readiness.md` and `docs/API_DEPLOYMENT.md` for current release evidence.

## Architecture decision

- Cloudflare Workers: API runtime.
- Cloudflare D1: relational business database.
- Cloudflare R2: private file and backup objects.
- Cloudflare KV: non-authoritative cache only; never use it as the ledger or source of truth.
- Cloudflare Queues: optional background work after transaction/idempotency and dead-letter handling tests.
- Otya Auth: shared identity service through a Worker service binding; OtyaPoint roles remain local and server-enforced.
- GitHub: source control, code review and CI.
- AWS: not part of the default stack. Reconsider only if a verified payment-provider requirement cannot be met safely by Cloudflare.

## Isolated resources created

- D1 `omnipoint-dev` — `2c4de5d4-6898-4768-9a60-091bca7779b5`, EU jurisdiction.
- R2 `omnipoint-dev-private` — private bucket; no public domain configured.
- R2 `omnipoint-dev-backups` — intended for backup artifacts; no backup is claimed until an export is stored and verified.
- KV `omnipoint-dev-cache` — `69ca8a463e60410d907749d4e863faf4`.
- Queue `omnipoint-dev-jobs` — `e8e3721ce4934094b2cb3d8fb5cb2edb`.
- Queue `omnipoint-dev-jobs-dlq` — `ef493d90b8d64801b5c95c2af31f0e31`.

The D1 core schema, company-scoping migration and staff-profile migration have been applied to the new development database. A read-only verification found the expected OtyaPoint tables, indexes and triggers and zero rows in the nine business tables. This verifies schema setup, not application correctness.

## Safety boundaries

- No public route or custom domain is configured for the new Worker.
- No Worker has been deployed from this branch.
- No live payment/provider operation is enabled.
- Existing Otya Workers, Otya databases, Otya assets, and legacy OtyaPoint resources have not been deleted.
- No credentials, tokens or secrets are stored in this repository.
- The older `omnipoint-prod` database remains untouched pending a final inventory and retirement plan.

## Next release gates

1. Fix the CI workflow so it validates Cloudflare D1 migrations and does not require legacy Supabase/Prisma setup for the new backend.
2. Run type-check, lint, build and schema/contract tests on this branch.
3. Review Otya Auth's actual token verification contract and test staff authorization, including suspended and unknown identities.
4. Test product/stock mutations, atomic sale posting, idempotency, concurrent requests, audit records and rollback.
5. Verify backup export retrieval, checksum and restore into a separate isolated database.
6. Connect a preview UI only after the API contract and authentication work; keep demo data separate.
7. Deploy an isolated non-public preview only after the above checks pass. Production cutover and live payments remain separate approvals.

## Resource cleanup policy

Do not delete old resources just because a newer development resource exists. First verify bindings, routes, data, object counts, queue consumers/producers, and dependencies. Remove an old resource only when it is confirmed OtyaPoint-only, has no remaining consumers, and the replacement has passed its recovery and acceptance tests.

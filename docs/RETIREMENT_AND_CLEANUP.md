# Rebuild cleanup and retirement controls

## Protected product

Omy Play is explicitly excluded from the Otya Enterprise rebuild. Do not change its app source, package identity, Firebase project, Cloudflare resources, R2 bucket, release pipeline, signing keys, user data or local-first playback behavior.

## Cleanup scope

The rebuild may consolidate Otya business systems, retire dead development paths and remove duplicate dependencies after the active replacement is verified.

Potential audit targets:
- legacy Supabase Auth dependencies in the OPoint dashboard;
- Prisma/PostgreSQL data models that duplicate the Cloudflare D1 business source;
- old OmniPoint labels and legacy domain links in OPoint UI/configuration;
- old provider sandbox adapters and payment-intent concepts that are not required by the recording/reconciliation product;
- duplicate D1 schemas, Workers, R2 buckets, queues, Firebase applications and build pipelines;
- test fixtures, unused packages, obsolete branches and stale deployment instructions.

These are candidates, not automatic deletion instructions. Some are still active. In particular, the existing dashboard has active Supabase auth references on the current main branch; remove them only after the Otya Auth session migration and protected-route tests pass.

## Required retirement sequence

1. Search source, lockfiles, CI, Cloudflare bindings, service bindings, DNS, cron triggers, queues, webhook registrations and mobile client configuration.
2. Identify the resource owner, product scope, production/staging status, data contents and last observed use.
3. Record the replacement and migration/rollback plan.
4. Copy/export any data or document evidence that must be retained; verify checksums and restore.
5. Remove code references and run all relevant tests.
6. Deploy the replacement to an isolated environment and observe it.
7. Disable the old resource only after all consumers have moved.
8. Delete only after an explicit inventory confirms it is unused and no retention obligation applies.

## Never do

- Never delete a database, Worker, bucket, Firebase project, secret, queue or DNS record solely because its name looks old.
- Never use a schema bootstrap snapshot to overwrite an existing database.
- Never remove old auth dependencies while any route still uses them.
- Never move Omy Play onto the Enterprise database or identity permissions.
- Never remove production resources as part of a staging rebuild.
- Never claim a resource is unused solely because source code no longer references it.

## Release discipline

The rebuild uses feature branches and draft PRs. CI must pass before merge. Staging migrations are forward-only and must be applied only to the isolated staging database after a schema backup and review. Production migrations, resource retirement, DNS changes, secrets, provider activation and live deployment are separate owner-approved release operations.

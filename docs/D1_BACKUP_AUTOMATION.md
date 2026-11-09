# OtyaPoint automated D1 backups

## What this workflow does

`.github/workflows/backup-d1.yml` exports the production `otyapoint-db` database once per day and stores the SQL dump in the existing private R2 bucket `otyapoint-backups`.

The workflow:

1. Starts a Cloudflare D1 export and polls until its signed download is ready.
2. Downloads the SQL dump to a temporary runner file, with a 512 MiB safety limit and SHA-256 calculation.
3. Uploads the dump to `otyapoint-backups/d1/otyapoint-db/YYYY-MM-DD/`.
4. Downloads the R2 object again and checks both SHA-256 and byte count against the source export.
5. Removes temporary SQL files from the GitHub runner.

Automatic OtyaPoint backups are orchestrated by the central OtyaEnd operations workflow `.github/workflows/backup-core-auth-d1.yml`, which runs daily at 04:15 UTC and exports Core, Auth and OtyaPoint using the shared production Cloudflare credential. The OtyaPoint-local workflow is retained as a manual fallback only; it does not run on every source push or create a second daily schedule.

## One-time GitHub configuration

For the central scheduled backup, configure the Cloudflare account ID and token in the OtyaEnd production GitHub environment. The token is shared by the OtyaEnd Core/Auth backup job and the OtyaPoint backup job. The OtyaPoint-local manual fallback still reads the repository settings below when run directly:

- Repository variable `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- Repository secret `OTYAPOINT_BACKUP_CLOUDFLARE_API_TOKEN`: a dedicated account API token.

Give this token only the permissions needed for this backup:

- **D1 Write** — required by the D1 export endpoint. Cloudflare documents that export uses a write permission because the export locks the database while it runs.
- **Workers R2 Storage Read** — used to download the object for read-back verification.
- **Workers R2 Storage Write** — used to upload the backup.

Restrict the token to the Otya Cloudflare account and, where the token editor supports resource-level scoping, to the `otyapoint-backups` bucket. Do not reuse an owner-wide API token. Do not paste the token into chat, source code, workflow files, or build logs.

The workflow deliberately fails before export if either configuration value is missing. It does not perform database migrations or deploy the API Worker.

## Backup naming and integrity

Each run writes a unique key similar to:

`d1/otyapoint-db/2026-11-09/backup-42600000000-1.sql`

The workflow prints the byte count and SHA-256 digest after successful R2 read-back. It does not print the Cloudflare token or the temporary signed download URL. The R2 bucket must remain private; do not enable public `r2.dev` access or attach a public custom domain.

The workflow does not delete older backups or change R2 lifecycle rules. Retention and deletion need a separate policy decision and a restore-tested retention period.

## What this does not prove

A green backup run proves that the export was stored in R2 and the stored object matched the downloaded export byte-for-byte. It does not prove that the database can be restored into a working OtyaPoint application.

Before production financial use, separately complete a restore drill into a disposable D1 database, verify the migration ledger, tables, indexes, triggers and representative business invariants, and document the exact restore commands. Keep the existing 30 October 2026 snapshots and restore-verification databases until that drill and a retention review are complete.

Production `otyapoint-db` records migrations `0001–0009` as applied (verified 2026-11-09). The same `0004–0009` sequence was first exercised against the isolated restore-verification D1 database. Production contains all 13 expected business tables and the expected integrity indexes/triggers; the business tables were empty at the time of migration. The dedicated OtyaPoint API Worker is still not deployed, and provider money movement remains disabled. This backup workflow does not change either state.

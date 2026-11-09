#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const DATABASE = Object.freeze({
  name: "otyapoint-db",
  id: "65cc4aee-154a-474f-9ed4-aabea0924c98",
  maxBytes: 512 * 1024 * 1024,
});

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${name}`);
  return value.trim();
}

export function buildBackupObjectKey(date, runId, attempt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must use YYYY-MM-DD");
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt))) {
    throw new Error("workflow run and attempt must contain digits only");
  }
  return `d1/otyapoint-db/${date}/backup-${runId}-${attempt}.sql`;
}

async function hashFile(path, maxBytes) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("D1 export exceeds the configured 512 MiB safety limit");
    hash.update(chunk);
  }
  if (bytes === 0) throw new Error("D1 export was empty");
  return { bytes, sha256: hash.digest("hex") };
}

export async function exportOtyaPointD1({
  accountId,
  apiToken,
  backupDir,
  date = new Date().toISOString().slice(0, 10),
  runId,
  attempt,
  runWrangler = (command, args, options) => execFileAsync(command, args, options),
}) {
  accountId = required(accountId, "CLOUDFLARE_ACCOUNT_ID");
  apiToken = required(apiToken, "CLOUDFLARE_API_TOKEN");
  runId = required(String(runId ?? ""), "GITHUB_RUN_ID");
  attempt = required(String(attempt ?? ""), "GITHUB_RUN_ATTEMPT");
  if (typeof runWrangler !== "function") throw new TypeError("runWrangler must be a function");

  const objectKey = buildBackupObjectKey(date, runId, attempt);
  const filePath = join(backupDir, `otyapoint-d1-${runId}-${attempt}.sql`);
  await mkdir(backupDir, { recursive: true });
  await rm(filePath, { force: true });

  try {
    const args = [
      "--yes", "wrangler@4.158.0", "d1", "export", DATABASE.name,
      "--remote",
      "--output", filePath,
      "--skip-confirmation",
      "--config", "wrangler.toml",
    ];
    await runWrangler("npx", args, {
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Wrangler did not produce a regular SQL export");
    if (fileStats.size > DATABASE.maxBytes) {
      throw new Error("D1 export exceeds the configured 512 MiB safety limit");
    }
    const digest = await hashFile(filePath, DATABASE.maxBytes);
    if (digest.bytes !== fileStats.size) throw new Error("D1 export size verification failed");
    return {
      filePath,
      objectKey,
      bytes: digest.bytes,
      sha256: digest.sha256,
      databaseId: DATABASE.id,
    };
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP?.trim() || "/tmp";
  const result = await exportOtyaPointD1({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    backupDir: runnerTemp,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `backup_file=${result.filePath}`,
        `object_key=${result.objectKey}`,
        `sha256=${result.sha256}`,
        `bytes=${result.bytes}`,
      ].join("\\n") + "\\n",
      { mode: 0o600 },
    );
  }
  process.stdout.write(
    `Prepared otyapoint-db: ${result.bytes} bytes; SHA-256 ${result.sha256}; destination otyapoint-backups/${result.objectKey}.\\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    process.stderr.write(`D1 backup export failed: ${error instanceof Error ? error.message : "unknown error"}\\n`);
    process.exitCode = 1;
  });
}

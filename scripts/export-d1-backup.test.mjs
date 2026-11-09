import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBackupObjectKey, exportOtyaPointD1 } from "./export-d1-backup.mjs";

const base = {
  accountId: "6c76d2a9e5f95d5f9b393e97374d9afb",
  apiToken: "private-test-token",
  date: "2026-11-09",
  runId: "42600000000",
  attempt: "1",
};

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "otyapoint-d1-backup-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("uses official remote Wrangler D1 export and verifies its SQL file", async () => {
  await withDir(async backupDir => {
    let called;
    const result = await exportOtyaPointD1({
      ...base,
      backupDir,
      runWrangler: async (command, args, options) => {
        called = { command, args, options };
        await writeFile(args[args.indexOf("--output") + 1], "CREATE TABLE products (id TEXT);\\n", { flag: "wx" });
      },
    });
    assert.equal(called.command, "npx");
    assert.ok(called.args.includes("d1"));
    assert.ok(called.args.includes("export"));
    assert.ok(called.args.includes("--remote"));
    assert.equal(called.args[called.args.indexOf("--config") + 1], "wrangler.toml");
    assert.equal(called.options.env.CLOUDFLARE_API_TOKEN, "private-test-token");
    assert.equal(called.args.includes("private-test-token"), false);
    assert.equal(result.objectKey, buildBackupObjectKey(base.date, base.runId, base.attempt));
    assert.equal(result.bytes, Buffer.byteLength("CREATE TABLE products (id TEXT);\\n"));
    assert.equal(await readFile(result.filePath, "utf8"), "CREATE TABLE products (id TEXT);\\n");
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  });
});

test("fails closed when account or token configuration is missing", async () => {
  await withDir(async backupDir => {
    await assert.rejects(exportOtyaPointD1({
      ...base, accountId: "", backupDir,
      runWrangler: async () => { throw new Error("should not run"); },
    }), /CLOUDFLARE_ACCOUNT_ID/);
    await assert.rejects(exportOtyaPointD1({
      ...base, apiToken: "", backupDir,
      runWrangler: async () => { throw new Error("should not run"); },
    }), /CLOUDFLARE_API_TOKEN/);
  });
});

test("fails and removes temporary file when Wrangler does not produce export", async () => {
  await withDir(async backupDir => {
    await assert.rejects(exportOtyaPointD1({
      ...base, backupDir, runWrangler: async () => {},
    }), /ENOENT|no such file/i);
  });
});

test("rejects oversize SQL dumps and deletes unsafe partial exports", async () => {
  await withDir(async backupDir => {
    await assert.rejects(exportOtyaPointD1({
      ...base, backupDir,
      runWrangler: async (_command, args) => {
        const target = args[args.indexOf("--output") + 1];
        await writeFile(target, "");
        const { truncate } = await import("node:fs/promises");
        await truncate(target, 512 * 1024 * 1024 + 1);
      },
    }), /512 MiB safety limit/);
  });
});

test("object keys are unique per workflow attempt and path-safe", () => {
  assert.equal(
    buildBackupObjectKey("2026-11-09", "42600000000", "2"),
    "d1/otyapoint-db/2026-11-09/backup-42600000000-2.sql",
  );
  assert.throws(() => buildBackupObjectKey("../x", "1", "1"), /YYYY-MM-DD/);
  assert.throws(() => buildBackupObjectKey("2026-11-09", "../1", "1"), /digits only/);
});

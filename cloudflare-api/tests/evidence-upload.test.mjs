import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "otya-evidence-test-"));
const parser = readFileSync(new URL("../src/transaction-message-parser.mjs", import.meta.url), "utf8");
writeFileSync(join(tempDir, "transaction-message-parser.mjs"), parser);
const source = readFileSync(new URL("../src/enterprise-intake.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "enterprise-intake.mjs"), compiled);
const { handleEnterpriseIntake } = await import(pathToFileURL(join(tempDir, "enterprise-intake.mjs")).href);

const staff = { id: "staff-owner", company_id: "company-1", role: "SOVEREIGN" };

function makeEnv() {
  const stored = new Map();
  const calls = { dbBatches: 0, put: 0, get: 0, delete: 0, lastPut: null };
  const env = {
    DB: {
      prepare(sql) {
        return {
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            if (sql.includes("FROM omni_enterprise_outlets")) return { id: "outlet-1", status: "ACTIVE" };
            if (sql.includes("FROM omni_evidence_files")) {
              return {
                id: "evidence-1",
                outlet_id: "outlet-1",
                storage_object_key: "company-1/evidence/outlet-1/evidence-1.png",
                original_filename: "agent receipt.png",
                content_type: "image/png",
                size_bytes: 5
              };
            }
            return null;
          },
          async all() { return { results: [] }; },
          async run() { return { meta: { changes: 1 } }; }
        };
      },
      async batch(statements) {
        calls.dbBatches++;
        return statements.map(() => ({ success: true }));
      }
    },
    PRIVATE_FILES: {
      async put(key, value, options) {
        calls.put++;
        calls.lastPut = { key, options, size: value.byteLength };
        stored.set(key, new Uint8Array(value));
      },
      async get(key) {
        calls.get++;
        const value = stored.get(key);
        if (!value) return null;
        return { body: new Response(value).body, size: value.byteLength, httpMetadata: { contentType: "image/png" } };
      },
      async delete(key) {
        calls.delete++;
        stored.delete(key);
      }
    }
  };
  return { env, calls, stored };
}

test("uploads evidence to private R2 and records only metadata in D1", async () => {
  const { env, calls, stored } = makeEnv();
  const response = await handleEnterpriseIntake(new Request("https://api.example.test/api/v1/evidence-files", {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "content-length": "5",
      "x-otya-outlet-id": "outlet-1",
      "x-otya-evidence-type": "PROVIDER_RECEIPT",
      "x-file-name": "receipt.png"
    },
    body: new Uint8Array([1, 2, 3, 4, 5])
  }), env, staff, "req-1", true);

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.processingStatus, "UPLOADED_NEEDS_EXTRACTION");
  assert.equal(body.data.private, true);
  assert.equal(calls.put, 1);
  assert.equal(calls.dbBatches, 1);
  assert.equal(calls.delete, 0);
  assert.equal(stored.size, 1);
  assert.equal(calls.lastPut.options.customMetadata.companyId, "company-1");
  assert.equal(calls.lastPut.options.httpMetadata.contentType, "image/png");
});

test("rejects unsupported content type before storing an object", async () => {
  const { env, calls } = makeEnv();
  const response = await handleEnterpriseIntake(new Request("https://api.example.test/api/v1/evidence-files", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-otya-outlet-id": "outlet-1",
      "x-otya-evidence-type": "PROVIDER_RECEIPT"
    },
    body: new Uint8Array([1, 2, 3])
  }), env, staff, "req-2", true);
  assert.equal(response.status, 400);
  assert.equal(calls.put, 0);
});

test("enforces the maximum upload size before storing an object", async () => {
  const { env, calls } = makeEnv();
  const response = await handleEnterpriseIntake(new Request("https://api.example.test/api/v1/evidence-files", {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "content-length": String(16 * 1024 * 1024),
      "x-otya-outlet-id": "outlet-1",
      "x-otya-evidence-type": "PROVIDER_RECEIPT"
    },
    body: new Uint8Array([1, 2, 3])
  }), env, staff, "req-3", true);
  assert.equal(response.status, 413);
  assert.equal(calls.put, 0);
});

test("downloads only through an outlet-scoped authenticated handler", async () => {
  const { env, calls, stored } = makeEnv();
  stored.set("company-1/evidence/outlet-1/evidence-1.png", new Uint8Array([10, 20, 30, 40, 50]));
  const response = await handleEnterpriseIntake(new Request("https://api.example.test/api/v1/evidence-files/evidence-1"), env, staff, "req-4", true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="agent receipt.png"');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 20, 30, 40, 50]);
  assert.equal(calls.get, 1);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
const compiledWorker = ts.transpileModule(workerSource, { compilerOptions }).outputText
  .replace('./providers/quickteller-business-sandbox', './quickteller-business-sandbox.mjs');
const compiledProvider = ts.transpileModule(providerSource, { compilerOptions }).outputText;
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-quickteller-route-"));
writeFileSync(join(tempDir, "index.mjs"), compiledWorker);
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const secrets = {
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret-never-return",
  merchantCode: "synthetic-merchant-never-return",
  payItemId: "synthetic-pay-item-never-return",
};
const activeOwner = {
  id: "staff-sovereign-test",
  identity_subject: "otya-user-sovereign-test",
  company_id: "company-test",
  branch_id: null,
  role: "SOVEREIGN",
  status: "ACTIVE",
  display_name: "Synthetic Owner",
  email: "owner@example.invalid",
  agent_id: null,
};

function makeEnv({ staff = activeOwner, secretValues = secrets, authResponse } = {}) {
  const calls = { auth: [], dbQueries: [], dbWrites: [] };
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            calls.dbQueries.push({ sql: this.sql, values: this.values });
            if (this.sql.includes("FROM omni_staff_memberships")) return staff;
            throw new Error("Unexpected D1 first() query: " + this.sql);
          },
          async all() { throw new Error("Unexpected D1 all() query: " + this.sql); },
          async run() {
            calls.dbWrites.push({ sql: this.sql, values: this.values });
            return { meta: { changes: 1 } };
          }
        };
        return statement;
      },
      async batch() { throw new Error("Unexpected D1 batch in Quickteller auth check"); }
    },
    AUTH: {
      async fetch(request) {
        calls.auth.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization") });
        return Response.json(authResponse ?? {
          ok: true,
          user_id: "otya-user-sovereign-test",
          email: "owner@example.invalid"
        });
      }
    },
    QUICKTELLER_CLIENT_ID: { async get() { return secretValues.clientId ?? ""; } },
    QUICKTELLER_CLIENT_SECRET: { async get() { return secretValues.clientSecret ?? ""; } },
    QUICKTELLER_MERCHANT_CODE: { async get() { return secretValues.merchantCode ?? ""; } },
    QUICKTELLER_PAY_ITEM_ID: { async get() { return secretValues.payItemId ?? ""; } }
  };
  return { env, calls };
}

async function check(env, token = "synthetic-otya-access-token") {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return worker.fetch(new Request("https://otyapoint.test/api/integrations/quickteller/sandbox-auth", {
    method: "POST",
    headers,
  }), env);
}

test("only a provisioned SOVEREIGN owner can initiate the sandbox OAuth check", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 });
  };

  const { env, calls } = makeEnv({ staff: { ...activeOwner, role: "MANAGER" } });
  const response = await check(env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
  assert.equal(providerCalls, 0);
  assert.equal(calls.dbWrites.length, 0);
});

test("successful owner check uses only the sandbox OAuth exchange and never returns secrets or tokens", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const providerCalls = [];
  globalThis.fetch = async (url, init) => {
    providerCalls.push({ url: String(url), init });
    return Response.json({ access_token: "synthetic-access-token-not-for-response", token_type: "Bearer", expires_in: 3600 });
  };

  const { env, calls } = makeEnv();
  const response = await check(env);
  const bodyText = await response.text();
  const body = JSON.parse(bodyText);

  assert.equal(response.status, 200);
  assert.equal(body.data.provider, "quickteller-business");
  assert.equal(body.data.environment, "sandbox");
  assert.equal(body.data.authentication, "successful");
  assert.equal(body.data.merchantConfiguration, "complete");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url,
    "https://passport-sandbox.interswitchng.com/passport/oauth/token?grant_type=client_credentials");
  assert.equal(providerCalls[0].init.method, "POST");
  assert.match(providerCalls[0].init.headers.Authorization, /^Basic /);
  assert.equal(providerCalls[0].init.body, "grant_type=client_credentials");
  assert.equal(providerCalls[0].init.redirect, "error");
  assert.equal(bodyText.includes(secrets.clientSecret), false);
  assert.equal(bodyText.includes(secrets.merchantCode), false);
  assert.equal(bodyText.includes(secrets.payItemId), false);
  assert.equal(bodyText.includes("synthetic-access-token-not-for-response"), false);
  assert.equal(calls.dbWrites.length, 1);
  assert.match(calls.dbWrites[0].sql, /INSERT INTO omni_audit_events/);
  const auditText = JSON.stringify(calls.dbWrites[0].values);
  assert.equal(auditText.includes(secrets.clientSecret), false);
  assert.equal(auditText.includes("synthetic-access-token"), false);
});

test("missing client credentials fail closed before any provider request", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ access_token: "unexpected-token", token_type: "Bearer", expires_in: 3600 });
  };

  const { env, calls } = makeEnv({ secretValues: { ...secrets, clientSecret: "" } });
  const response = await check(env);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "quickteller_oauth_credentials_incomplete");
  assert.equal(body.data.authentication, "not_checked");
  assert.equal(providerCalls, 0);
  assert.equal(calls.dbWrites.length, 1);
});

test("provider authentication rejection is safely reported without its response body or credential leakage", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(
    "provider detail includes " + secrets.clientSecret,
    { status: 401 }
  );

  const { env, calls } = makeEnv();
  const response = await check(env);
  const bodyText = await response.text();
  const body = JSON.parse(bodyText);
  assert.equal(response.status, 502);
  assert.equal(body.error, "quickteller_authentication_rejected");
  assert.equal(body.data.authentication, "failed");
  assert.equal(body.data.providerStatus, 401);
  assert.equal(bodyText.includes(secrets.clientSecret), false);
  assert.equal(bodyText.includes("provider detail"), false);
  assert.equal(JSON.stringify(calls.dbWrites).includes(secrets.clientSecret), false);
});

test("missing bearer authentication is rejected before any owner lookup or provider request", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ access_token: "unexpected-token", token_type: "Bearer", expires_in: 3600 });
  };

  const { env, calls } = makeEnv();
  const response = await check(env, "");
  assert.equal(response.status, 401);
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.dbQueries.length, 0);
  assert.equal(providerCalls, 0);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

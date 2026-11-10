import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace('./providers/quickteller-business-sandbox', './quickteller-business-sandbox.mjs');
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-auth-boundary-"));
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiledProvider = ts.transpileModule(providerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const activeStaff = {
  id: "staff-auth-test",
  identity_subject: "otya-user-auth-test",
  company_id: "company-auth-test",
  branch_id: "branch-auth-test",
  role: "ATTENDANT",
  status: "ACTIVE",
  display_name: "Synthetic Auth Test",
  email: "auth-test@example.invalid",
  agent_id: "AGENT001"
};

function makeEnv({ authResponse, authError, staff = activeStaff } = {}) {
  const calls = { auth: [], queries: [] };
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            calls.queries.push({ sql: this.sql, values: this.values });
            if (this.sql.includes("FROM omni_staff_memberships")) return staff;
            throw new Error("Unexpected first() query: " + this.sql);
          },
          async all() { throw new Error("Unexpected all() query: " + this.sql); },
          async run() { throw new Error("Unexpected run() query: " + this.sql); }
        };
        return statement;
      },
      async batch() { throw new Error("Unexpected DB batch in auth boundary test"); }
    },
    PRIVATE_FILES: {},
    BACKUPS: {},
    CACHE: {},
    JOBS: {},
    AUTH: {
      async fetch(request) {
        calls.auth.push({
          url: request.url,
          method: request.method,
          authorization: request.headers.get("authorization")
        });
        if (authError) throw authError;
        return Response.json(authResponse ?? {
          ok: true,
          user_id: "otya-user-auth-test",
          email: "verified@example.invalid"
        });
      }
    }
  };
  return { env, calls };
}

async function getMe(env, token = "synthetic-auth-token") {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return worker.fetch(new Request("https://otyapoint.test/api/me", { method: "GET", headers }), env);
}

test("rejects missing bearer token before contacting Otya Auth or D1", async () => {
  const { env, calls } = makeEnv();
  const response = await getMe(env, "");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.queries.length, 0);
});

test("rejects an unverified Otya Auth response without querying staff membership", async () => {
  const { env, calls } = makeEnv({ authResponse: { ok: false, user_id: "otya-user-auth-test" } });
  const response = await getMe(env);
  assert.equal(response.status, 401);
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.auth[0].url, "https://auth/auth/verify");
  assert.equal(calls.auth[0].method, "GET");
  assert.equal(calls.auth[0].authorization, "Bearer synthetic-auth-token");
  assert.equal(calls.queries.length, 0);
});

test("fails closed with 503 when the Otya Auth service binding throws", async () => {
  const { env, calls } = makeEnv({ authError: new Error("synthetic service failure") });
  const response = await getMe(env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "auth_service_unavailable" });
  assert.equal(calls.queries.length, 0);
});

test("denies an inactive staff membership after identity verification", async () => {
  const { env, calls } = makeEnv({ staff: { ...activeStaff, status: "SUSPENDED" } });
  const response = await getMe(env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "staff_access_denied" });
  assert.equal(calls.queries.length, 1);
  assert.deepEqual(calls.queries[0].values, ["otya-user-auth-test"]);
});

test("denies an unknown role even when the identity and staff row exist", async () => {
  const { env } = makeEnv({ staff: { ...activeStaff, role: "ROOT_EVERYTHING" } });
  const response = await getMe(env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "staff_access_denied" });
});

test("maps the verified Otya identity subject to an active staff membership", async () => {
  const { env, calls } = makeEnv();
  const response = await getMe(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(body => body.data), {
    id: "staff-auth-test",
    identitySubject: "otya-user-auth-test",
    companyId: "company-auth-test",
    branchId: "branch-auth-test",
    role: "ATTENDANT",
    status: "ACTIVE",
    displayName: "Synthetic Auth Test",
    email: "verified@example.invalid",
    agentId: "AGENT001"
  });
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.queries.length, 1);
  assert.match(calls.queries[0].sql, /identity_subject = \?1/);
  assert.deepEqual(calls.queries[0].values, ["otya-user-auth-test"]);
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

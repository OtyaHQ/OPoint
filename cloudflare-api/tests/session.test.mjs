import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "otya-session-test-"));
const source = readFileSync(new URL("../src/session.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "session.mjs"), compiled);
const { handleSessionRoutes } = await import(pathToFileURL(join(tempDir, "session.mjs")).href);

const staff = {
  id: "staff-1",
  identity_subject: "identity-1",
  company_id: "company-1",
  role: "ATTENDANT",
  status: "ACTIVE",
  display_name: "Teller One",
  agent_id: "OTYA-T-001"
};

function makeEnv({ membership = staff } = {}) {
  const calls = [];
  return {
    calls,
    env: {
      DB: {
        prepare(sql) {
          return {
            bind(...values) {
              this.values = values;
              return this;
            },
            async first() {
              calls.push({ type: "db.first", sql: sql.slice(0, 80), values: this.values });
              return membership;
            }
          };
        }
      },
      AUTH: {
        async fetch(request) {
          const url = new URL(request.url);
          const body = request.method === "POST" ? await request.json() : null;
          calls.push({ type: "auth", path: url.pathname, body });
          if (url.pathname === "/auth/login") {
            return Response.json({
              ok: true,
              access_token: "access-token-for-test",
              refresh_token: "refresh-token-for-test"
            });
          }
          if (url.pathname === "/auth/verify") {
            return Response.json({ ok: true, user_id: "identity-1", email: "teller@example.invalid" });
          }
          if (url.pathname === "/auth/refresh") {
            return Response.json({ ok: true, access_token: "refreshed-access-token" });
          }
          if (url.pathname === "/auth/logout") return Response.json({ ok: true });
          return Response.json({ error: "unknown_route" }, { status: 404 });
        }
      }
    }
  };
}

test("login uses Otya Auth and sets HttpOnly cookies only for active company staff", async () => {
  const { env, calls } = makeEnv();
  const request = new Request("https://enterprise.example.test/api/v1/session/login", {
    method: "POST",
    headers: {
      origin: "https://enterprise.example.test",
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: "Teller@example.invalid", password: "correct-horse" })
  });
  const response = await handleSessionRoutes(request, env, "request-1");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.role, "ATTENDANT");
  assert.equal(body.data.displayName, "Teller One");
  assert.equal(JSON.stringify(body).includes("access-token-for-test"), false);
  assert.equal(JSON.stringify(body).includes("refresh-token-for-test"), false);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /__Host-otya_access=/);
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[0], /SameSite=Strict/);
  assert.match(cookies[1], /__Secure-otya_refresh=/);
  assert.match(cookies[1], /Path=\/api\/v1\/session/);
  assert.ok(calls.some(call => call.type === "auth" && call.path === "/auth/login"));
  assert.ok(calls.some(call => call.type === "auth" && call.path === "/auth/verify"));
});

test("login refuses non-staff Otya accounts and revokes the newly issued refresh token", async () => {
  const { env, calls } = makeEnv({ membership: null });
  const response = await handleSessionRoutes(new Request("https://enterprise.example.test/api/v1/session/login", {
    method: "POST",
    headers: { origin: "https://enterprise.example.test", "content-type": "application/json" },
    body: JSON.stringify({ email: "customer@example.invalid", password: "correct-horse" })
  }), env, "request-2");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(calls.some(call => call.type === "auth" && call.path === "/auth/logout"));
});

test("cookie login rejects cross-origin requests", async () => {
  const { env, calls } = makeEnv();
  const response = await handleSessionRoutes(new Request("https://enterprise.example.test/api/v1/session/login", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ email: "teller@example.invalid", password: "secret" })
  }), env, "request-3");
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("refresh returns a new access cookie and keeps the refresh cookie HttpOnly", async () => {
  const { env } = makeEnv();
  const response = await handleSessionRoutes(new Request("https://enterprise.example.test/api/v1/session/refresh", {
    method: "POST",
    headers: {
      origin: "https://enterprise.example.test",
      cookie: "__Secure-otya_refresh=existing-refresh-token"
    }
  }), env, "request-4");
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /__Host-otya_access=refreshed-access-token/);
  assert.match(cookies[0], /HttpOnly/);
  assert.equal(cookies[0].includes("refresh"), false);
});

test("logout revokes the refresh token and clears both cookies", async () => {
  const { env, calls } = makeEnv();
  const response = await handleSessionRoutes(new Request("https://enterprise.example.test/api/v1/session/logout", {
    method: "POST",
    headers: {
      origin: "https://enterprise.example.test",
      cookie: "__Secure-otya_refresh=existing-refresh-token"
    }
  }), env, "request-5");
  assert.equal(response.status, 200);
  assert.ok(calls.some(call => call.type === "auth" && call.path === "/auth/logout" && call.body.refresh_token === "existing-refresh-token"));
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => /Max-Age=0/.test(cookie)));
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

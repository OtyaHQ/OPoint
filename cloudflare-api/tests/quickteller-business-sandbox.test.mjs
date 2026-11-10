import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const source = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const tempDir = mkdtempSync(join(tmpdir(), "otya-quickteller-sandbox-"));
const modulePath = join(tempDir, "quickteller-business-sandbox.mjs");
writeFileSync(modulePath, compiled);
const {
  QuicktellerBusinessSandboxClient,
  QuicktellerBusinessError,
  QUICKTELLER_SANDBOX_TOKEN_URL,
  QUICKTELLER_SANDBOX_STATUS_URL
} = await import(pathToFileURL(modulePath).href);

const credentials = { clientId: "test-client-id", clientSecret: "secret-that-must-not-leak" };

test("OAuth token exchange uses the sandbox endpoint and Basic client credentials", async () => {
  let call;
  const client = new QuicktellerBusinessSandboxClient({
    ...credentials,
    fetchImpl: async (url, init) => {
      call = { url: String(url), init };
      return Response.json({ access_token: "sandbox-token", token_type: "Bearer", expires_in: 3600 });
    }
  });

  assert.equal(await client.getAccessToken(), "sandbox-token");
  assert.equal(call.url, QUICKTELLER_SANDBOX_TOKEN_URL + "?grant_type=client_credentials");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization,
    "Basic " + Buffer.from(credentials.clientId + ":" + credentials.clientSecret).toString("base64"));
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(call.init.body, "grant_type=client_credentials");
});

test("concurrent callers share one token request and status enquiry is read-only", async () => {
  const calls = [];
  let releaseToken;
  const tokenGate = new Promise(resolve => { releaseToken = resolve; });
  const client = new QuicktellerBusinessSandboxClient({
    ...credentials,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith(QUICKTELLER_SANDBOX_TOKEN_URL)) {
        await tokenGate;
        return Response.json({ access_token: "sandbox-token", token_type: "bearer", expires_in: 3600 });
      }
      return Response.json({ ResponseCode: "00", Amount: 12500 });
    }
  });

  const first = client.getTransactionStatus("otya-ref-001", 12500);
  const second = client.getTransactionStatus("otya-ref-002", 12500);
  await Promise.resolve();
  releaseToken();
  const [one, two] = await Promise.all([first, second]);

  assert.equal(one.status, "CONFIRMED_SUCCESS");
  assert.equal(one.amountMatched, true);
  assert.equal(two.status, "CONFIRMED_SUCCESS");
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);

  const statusCalls = calls.filter(call => call.init.method === "GET");
  assert.equal(statusCalls.length, 2);
  for (const call of statusCalls) {
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, QUICKTELLER_SANDBOX_STATUS_URL);
    assert.ok(url.searchParams.get("transactionRef").startsWith("otya-ref-"));
    assert.equal(url.searchParams.get("amount"), "12500");
    assert.equal(call.init.headers.Authorization, "Bearer sandbox-token");
    assert.equal(call.init.redirect, "error");
  }
});

test("transaction status is not success when the response code or amount does not match", async () => {
  let statusPayload = { ResponseCode: "00", Amount: 12499 };
  const client = new QuicktellerBusinessSandboxClient({
    ...credentials,
    fetchImpl: async url => String(url).startsWith(QUICKTELLER_SANDBOX_TOKEN_URL)
      ? Response.json({ access_token: "sandbox-token", token_type: "bearer", expires_in: 3600 })
      : Response.json(statusPayload)
  });

  const mismatch = await client.getTransactionStatus("otya-ref-002", 12500);
  assert.deepEqual(mismatch, {
    status: "NOT_CONFIRMED", responseCode: "00", amountMatched: false
  });

  statusPayload = { ResponseCode: "90000", Amount: 12500 };
  const decline = await client.getTransactionStatus("otya-ref-003", 12500);
  assert.deepEqual(decline, {
    status: "NOT_CONFIRMED", responseCode: "90000", amountMatched: true
  });
});

test("invalid configuration and amounts fail closed before provider calls", async () => {
  assert.throws(() => new QuicktellerBusinessSandboxClient({
    clientId: "", clientSecret: credentials.clientSecret
  }), QuicktellerBusinessError);

  let calls = 0;
  const client = new QuicktellerBusinessSandboxClient({
    ...credentials,
    fetchImpl: async () => { calls += 1; return Response.json({ access_token: "x", expires_in: 60 }); }
  });
  await assert.rejects(() => client.getTransactionStatus("ref", 0), QuicktellerBusinessError);
  assert.equal(calls, 0);
});

test("authentication errors never expose the client secret or provider response body", async () => {
  const client = new QuicktellerBusinessSandboxClient({
    ...credentials,
    fetchImpl: async () => new Response("sensitive-provider-detail", { status: 401 })
  });

  await assert.rejects(
    () => client.getAccessToken(),
    error => {
      assert.ok(error instanceof QuicktellerBusinessError);
      assert.equal(error.kind, "http");
      assert.equal(error.httpStatus, 401);
      assert.equal(error.message.includes(credentials.clientSecret), false);
      assert.equal(error.message.includes("sensitive-provider-detail"), false);
      return true;
    }
  );
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

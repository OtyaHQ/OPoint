import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.mjs";

const env = { LOCAL_AUTH_ONLY: "true" };
const request = (path = "/auth/verify", options = {}) => new Request(`https://auth.local${path}`, options);

test("returns the synthetic owner only for the local test bearer token", async () => {
  const response = await worker.fetch(request("/auth/verify", {
    method: "GET",
    headers: { authorization: "Bearer otya-local-test-token" },
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    user_id: "synthetic-otyapoint-local-owner",
    email: "owner@local.invalid",
  });
});

test("rejects missing or incorrect local tokens", async () => {
  const missing = await worker.fetch(request("/auth/verify", { method: "GET" }), env);
  const incorrect = await worker.fetch(request("/auth/verify", {
    method: "GET",
    headers: { authorization: "Bearer not-the-local-token" },
  }), env);

  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
});

test("does not run when the explicit local-only flag is absent", async () => {
  const response = await worker.fetch(request("/auth/verify", {
    method: "GET",
    headers: { authorization: "Bearer otya-local-test-token" },
  }), {});

  assert.equal(response.status, 404);
});

test("does not expose any other path or method", async () => {
  const wrongPath = await worker.fetch(request("/auth/login", { method: "GET" }), env);
  const wrongMethod = await worker.fetch(request("/auth/verify", { method: "POST" }), env);

  assert.equal(wrongPath.status, 404);
  assert.equal(wrongMethod.status, 404);
});

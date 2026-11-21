import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

test("company creation rejects an oversized streamed JSON body before database access", async () => {
  let databaseTouched = false;
  const env = {
    OID: {
      async fetch(request) {
        assert.equal(request.url, "https://oid/auth/verify");
        return Response.json({
          ok: true,
          user_id: "identity-worker-1",
          email: "owner@example.invalid",
          email_verified: true,
        });
      },
    },
    DB: {
      prepare() {
        databaseTouched = true;
        throw new Error("D1 must not be reached for an oversized body");
      },
    },
  };

  const request = new Request("https://opoint.internal/v1/companies", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-access-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ displayName: "x".repeat(17_000) }),
  });

  assert.equal(request.headers.has("content-length"), false);
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "request_too_large" });
  assert.equal(databaseTouched, false);
});

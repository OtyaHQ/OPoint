// Synthetic Otya Auth replacement for local OtyaPoint development ONLY.
// Never deploy this Worker and never use this token outside Wrangler --local.
const LOCAL_TEST_TOKEN = "otya-local-test-token";
const LOCAL_IDENTITY = "synthetic-otyapoint-local-owner";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    if (env.LOCAL_AUTH_ONLY !== "true") {
      return json({ error: "local_auth_disabled" }, 404);
    }

    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/auth/verify") {
      return json({ error: "not_found" }, 404);
    }

    if (request.headers.get("authorization") !== `Bearer ${LOCAL_TEST_TOKEN}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    return json({
      ok: true,
      user_id: LOCAL_IDENTITY,
      email: "owner@local.invalid",
    });
  },
};

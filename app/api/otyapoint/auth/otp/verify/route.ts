import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  appendSessionCookies,
  getOtyaWorkerBindings,
  hasSameOrigin,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) {
    return jsonResponse({ error: "same_origin_required" }, 403);
  }

  const parsed = await readJsonBody(request, 2_048);
  if ("error" in parsed) {
    return jsonResponse({ error: parsed.error }, parsed.status);
  }

  const email = typeof parsed.value.email === "string"
    ? parsed.value.email.trim().toLowerCase()
    : "";
  const code = typeof parsed.value.code === "string"
    ? parsed.value.code.trim().toUpperCase()
    : "";
  if (
    !email
    || email.length > 254
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    || !/^[A-Z][0-9]{4}$/.test(code)
  ) {
    return jsonResponse({ error: "invalid_or_expired_sign_in_code" }, 401);
  }

  const bindings = await getOtyaWorkerBindings();
  if (!bindings?.OTYA_ID) {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }

  try {
    const upstream = await bindings.OTYA_ID.fetch(new Request(
      "https://auth/auth/login/otp/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email, code }),
        signal: AbortSignal.timeout(8_000),
      },
    ));
    const body = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) {
      return jsonResponse(body, upstream.status);
    }

    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!accessToken || !refreshToken) {
      return jsonResponse({ error: "identity_session_incomplete" }, 502);
    }

    delete body.access_token;
    delete body.refresh_token;
    const headers = new Headers();
    appendSessionCookies(headers, accessToken, refreshToken);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "private, no-store, max-age=0");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "same-origin");
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }
}

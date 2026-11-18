import {
  appendClearedSessionCookies,
  getOtyaWorkerBindings,
  hasSameOrigin,
  jsonResponse,
  readCookie,
  REFRESH_COOKIE,
} from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const headers = new Headers();
  appendClearedSessionCookies(headers);

  if (!hasSameOrigin(request)) {
    return jsonResponse({ error: "same_origin_required" }, 403, headers);
  }

  const refreshToken = readCookie(request, REFRESH_COOKIE);
  const bindings = await getOtyaWorkerBindings();
  if (!bindings?.OTYA_ID) {
    return jsonResponse({ error: "identity_service_unavailable" }, 503, headers);
  }

  if (refreshToken) {
    try {
      await bindings.OTYA_ID.fetch(new Request("https://auth/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(8_000),
      }));
    } catch {
      // Local cookies are still cleared even if the Auth Worker cannot be reached.
    }
  }

  return jsonResponse({ ok: true }, 200, headers);
}

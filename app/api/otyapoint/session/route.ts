import {
  getOtyaSession,
  jsonResponse,
} from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const result = await getOtyaSession(request);
  if ("error" in result) {
    return jsonResponse(
      { ok: false, authenticated: false, error: result.error },
      result.status,
      result.cookieHeaders,
    );
  }
  if (!result.authenticated) {
    const headers = new Headers(result.cookieHeaders);
    return jsonResponse({ ok: true, authenticated: false }, 200, headers);
  }

  return jsonResponse({
    ok: true,
    authenticated: true,
    user: result.session.identity,
    memberships: result.session.memberships,
  }, 200, result.session.cookieHeaders);
}

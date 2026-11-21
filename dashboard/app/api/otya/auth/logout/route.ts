import { cookies } from "next/headers";
import {
  clearSessionCookies,
  isSameOriginRequest,
  jsonResponse,
  REFRESH_COOKIE,
  workerEnv,
} from "@/lib/otya";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ error: "same_origin_required" }, 403);
  }

  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value ?? "";
  let logoutFailed = false;

  if (refreshToken) {
    try {
      const upstream = await workerEnv.OID.fetch(new Request("https://auth/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(8000),
      }));
      logoutFailed = !upstream.ok;
    } catch {
      logoutFailed = true;
    }
  }

  clearSessionCookies(jar);
  return jsonResponse({ ok: true, remoteRevocationConfirmed: !logoutFailed }, logoutFailed ? 503 : 200);
}

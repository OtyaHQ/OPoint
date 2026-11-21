import { cookies } from "next/headers";
import {
  isSameOriginRequest,
  jsonResponse,
  loadBrowserSession,
  readJsonLimited,
  workerEnv,
} from "@/lib/otya";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "same_origin_required" }, 403);

  const parsed = await readJsonLimited(request, 2048);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, parsed.status);

  const action = typeof parsed.value.action === "string" ? parsed.value.action : "";
  const otp = typeof parsed.value.otp === "string" ? parsed.value.otp.trim().toUpperCase() : "";
  if (action !== "send" && action !== "verify") return jsonResponse({ error: "invalid_email_verification_action" }, 400);
  if (action === "verify" && !/^[A-Z][0-9]{4}$/.test(otp)) return jsonResponse({ error: "invalid_verification_code" }, 400);

  const jar = await cookies();
  const session = await loadBrowserSession(jar);
  if (session.kind === "anonymous") return jsonResponse({ error: "authentication_required" }, 401);
  if (session.kind === "unavailable") return jsonResponse({ error: "identity_service_unavailable" }, 503);
  if (session.session.identity.emailVerified) return jsonResponse({ ok: true, emailVerified: true });

  try {
    const path = action === "send" ? "/auth/send-verification" : "/auth/verify-email";
    const upstream = await workerEnv.OID.fetch(new Request("https://auth" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.session.accessToken,
      },
      body: JSON.stringify(action === "verify" ? { otp } : {}),
      signal: AbortSignal.timeout(8000),
    }));
    const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) {
      return jsonResponse({ error: typeof data.error === "string" ? data.error : "email_verification_failed" }, upstream.status);
    }

    if (action === "verify") {
      const check = await workerEnv.OID.fetch(new Request("https://auth/auth/verify", {
        method: "GET",
        headers: { Authorization: "Bearer " + session.session.accessToken, Accept: "application/json" },
      }));
      const current = await check.json().catch(() => ({})) as Record<string, unknown>;
      return jsonResponse({
        ok: true,
        emailVerified: current.email_verified === true || current.email_verified === 1 || current.email_verified === "true",
      });
    }

    return jsonResponse({ ok: true, message: typeof data.message === "string" ? data.message : "verification_code_sent" });
  } catch {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }
}

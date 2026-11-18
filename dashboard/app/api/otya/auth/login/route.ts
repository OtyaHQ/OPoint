import { cookies } from "next/headers";
import {
  clearSessionCookies,
  isSameOriginRequest,
  jsonResponse,
  readJsonLimited,
  setSessionCookies,
  workerEnv,
} from "@/lib/otya";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ error: "same_origin_required" }, 403);
  }

  const parsed = await readJsonLimited(request, 8192);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, parsed.status);

  const email = typeof parsed.value.email === "string" ? parsed.value.email.trim().toLowerCase() : "";
  const password = typeof parsed.value.password === "string" ? parsed.value.password : "";
  const totpCode = typeof parsed.value.totpCode === "string" ? parsed.value.totpCode.trim() : "";
  const recoveryCode = typeof parsed.value.recoveryCode === "string" ? parsed.value.recoveryCode.trim() : "";

  if (!email || !password || email.length > 254 || password.length > 1024) {
    return jsonResponse({ error: "email_and_password_required" }, 400);
  }
  if (totpCode && totpCode.length > 32) return jsonResponse({ error: "invalid_two_factor_code" }, 400);
  if (recoveryCode && recoveryCode.length > 128) return jsonResponse({ error: "invalid_recovery_code" }, 400);

  try {
    const upstream = await workerEnv.OTYA_ID.fetch(new Request("https://auth/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(request.headers.get("cf-connecting-ip") ? { "CF-Connecting-IP": request.headers.get("cf-connecting-ip") as string } : {}),
        ...(request.headers.get("user-agent") ? { "User-Agent": request.headers.get("user-agent") as string } : {}),
      },
      body: JSON.stringify({
        email,
        password,
        ...(totpCode ? { totp_code: totpCode } : {}),
        ...(recoveryCode ? { recovery_code: recoveryCode } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    }));

    const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) {
      const error = typeof data.error === "string" ? data.error : "sign_in_failed";
      return jsonResponse({ error, ...(typeof data.code === "string" ? { code: data.code } : {}) }, upstream.status);
    }

    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
    if (!accessToken || !refreshToken) {
      return jsonResponse({ error: "authentication_session_incomplete" }, 502);
    }

    const verify = await workerEnv.OTYA_ID.fetch(new Request("https://auth/auth/verify", {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    }));
    if (!verify.ok) {
      return jsonResponse({ error: "identity_verification_failed" }, 502);
    }
    const identity = await verify.json().catch(() => ({})) as Record<string, unknown>;
    if (identity.ok !== true || typeof identity.user_id !== "string") {
      return jsonResponse({ error: "identity_verification_failed" }, 502);
    }

    const jar = await cookies();
    setSessionCookies(jar, accessToken, refreshToken);

    return jsonResponse({
      authenticated: true,
      identity: {
        userId: identity.user_id,
        email: typeof identity.email === "string" ? identity.email : null,
        emailVerified: identity.email_verified === true || identity.email_verified === 1 || identity.email_verified === "true",
      },
    });
  } catch {
    const jar = await cookies();
    clearSessionCookies(jar);
    return jsonResponse({ error: "authentication_service_unavailable" }, 503);
  }
}

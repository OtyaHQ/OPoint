import {
  getOtyaWorkerBindings,
  hasSameOrigin,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE = "If an Otya account exists for that email, a sign-in code has been sent.";

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
  if (!email || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return jsonResponse({ ok: true, message: GENERIC_MESSAGE }, 202);
  }

  const bindings = await getOtyaWorkerBindings();
  if (!bindings?.OTYA_ID) {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }

  try {
    const upstream = await bindings.OTYA_ID.fetch(new Request(
      "https://auth/auth/login/otp/request",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "unknown" },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(8_000),
      },
    ));
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
      },
    });
  } catch {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }
}

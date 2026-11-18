import "server-only";

export const ACCESS_COOKIE = "__Host-otya_access";
export const REFRESH_COOKIE = "__Host-otya_refresh";
const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;
const IDENTITY_TIMEOUT_MS = 8_000;

type ServiceBinding = { fetch(request: Request): Promise<Response> };

export type OtyaWorkerBindings = {
  OTYA_ID?: ServiceBinding;
  OPOINT_API?: ServiceBinding;
};

type JsonRecord = Record<string, unknown>;

type AuthIdentity = {
  userId: string;
  email: string;
  emailVerified: boolean;
};

export type OtyaSession = {
  identity: AuthIdentity;
  memberships: JsonRecord[];
  accessToken: string;
  refreshToken: string;
  cookieHeaders: Headers;
};

export type SessionLookup =
  | { authenticated: true; session: OtyaSession }
  | { authenticated: false; cookieHeaders: Headers }
  | { error: string; status: number; cookieHeaders: Headers };

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const out = new Headers(headers);
  out.set("content-type", "application/json; charset=utf-8");
  out.set("cache-control", "private, no-store, max-age=0");
  out.set("pragma", "no-cache");
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "same-origin");
  return new Response(JSON.stringify(body), { status, headers: out });
}

export function appendSessionCookies(
  headers: Headers,
  accessToken: string,
  refreshToken: string,
): void {
  headers.append(
    "set-cookie",
    `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; Max-Age=${ACCESS_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
  );
  headers.append(
    "set-cookie",
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; Path=/; Max-Age=${REFRESH_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
  );
}

export function appendClearedSessionCookies(headers: Headers): void {
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  headers.append(
    "set-cookie",
    `${ACCESS_COOKIE}=; Path=/; Max-Age=0; Expires=${expires}; Secure; HttpOnly; SameSite=Lax`,
  );
  headers.append(
    "set-cookie",
    `${REFRESH_COOKIE}=; Path=/; Max-Age=0; Expires=${expires}; Secure; HttpOnly; SameSite=Lax`,
  );
}

export function readCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return "";
    }
  }
  return "";
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 4_096,
): Promise<{ value: JsonRecord } | { error: string; status: number }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { error: "invalid_request_body", status: 400 };
  }
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "invalid_json_object", status: 400 };
    }
    return { value: value as JsonRecord };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

export async function getOtyaWorkerBindings(): Promise<OtyaWorkerBindings | null> {
  try {
    // This module exists in the Cloudflare Workers runtime. webpackIgnore keeps
    // the legacy Node/Next build from attempting to bundle a Workers-only module;
    // @vite-ignore leaves the built-in specifier for the Workers runtime.
    const runtime = await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      "cloudflare:workers"
    );
    const env = runtime.env as OtyaWorkerBindings | undefined;
    return env ?? null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<JsonRecord> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : {};
  } catch {
    return {};
  }
}

async function verifyAccessToken(
  auth: ServiceBinding,
  accessToken: string,
): Promise<{ response: Response; body: JsonRecord }> {
  const response = await auth.fetch(new Request("https://auth/auth/verify", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
  }));
  return { response, body: await readJson(response) };
}

async function refreshAccessToken(
  auth: ServiceBinding,
  refreshToken: string,
): Promise<string | null> {
  const response = await auth.fetch(new Request("https://auth/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
  }));
  if (!response.ok) return null;
  const body = await readJson(response);
  return typeof body.access_token === "string" ? body.access_token : null;
}

export async function getOtyaSession(request: Request): Promise<SessionLookup> {
  const cookieHeaders = new Headers();
  const bindings = await getOtyaWorkerBindings();
  if (!bindings?.OTYA_ID?.fetch || !bindings?.OPOINT_API?.fetch) {
    return { error: "cloudflare_service_bindings_unavailable", status: 503, cookieHeaders };
  }

  const refreshToken = readCookie(request, REFRESH_COOKIE);
  let accessToken = readCookie(request, ACCESS_COOKIE);
  let verified: { response: Response; body: JsonRecord } | null = null;

  if (accessToken) {
    try {
      verified = await verifyAccessToken(bindings.OTYA_ID!, accessToken);
    } catch {
      return { error: "identity_service_unavailable", status: 503, cookieHeaders };
    }
  }

  if (!verified || !verified.response.ok) {
    if (verified && verified.response.status >= 500) {
      return { error: "identity_service_unavailable", status: 503, cookieHeaders };
    }
    if (!refreshToken) {
      appendClearedSessionCookies(cookieHeaders);
      return { authenticated: false, cookieHeaders };
    }
    try {
      const refreshed = await refreshAccessToken(bindings.OTYA_ID!, refreshToken);
      if (!refreshed) {
        appendClearedSessionCookies(cookieHeaders);
        return { authenticated: false, cookieHeaders };
      }
      accessToken = refreshed;
      verified = await verifyAccessToken(bindings.OTYA_ID!, accessToken);
      if (!verified.response.ok) {
        if (verified.response.status >= 500) {
          return { error: "identity_service_unavailable", status: 503, cookieHeaders };
        }
        appendClearedSessionCookies(cookieHeaders);
        return { authenticated: false, cookieHeaders };
      }
      appendSessionCookies(cookieHeaders, accessToken, refreshToken);
    } catch {
      return { error: "identity_service_unavailable", status: 503, cookieHeaders };
    }
  }

  const userId = typeof verified.body.user_id === "string" ? verified.body.user_id : "";
  const email = typeof verified.body.email === "string" ? verified.body.email : "";
  if (!userId || !email) {
    appendClearedSessionCookies(cookieHeaders);
    return { authenticated: false, cookieHeaders };
  }

  try {
    const membershipResponse = await bindings.OPOINT_API!.fetch(new Request(
      "https://opoint/v1/me",
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      },
    ));
    if (!membershipResponse.ok) {
      return {
        error: membershipResponse.status >= 500 ? "company_service_unavailable" : "company_membership_lookup_failed",
        status: membershipResponse.status >= 500 ? 503 : membershipResponse.status,
        cookieHeaders,
      };
    }
    const membershipBody = await readJson(membershipResponse);
    const responseData = membershipBody.data && typeof membershipBody.data === "object"
      ? membershipBody.data as JsonRecord
      : {};
    const memberships = Array.isArray(responseData.memberships)
      ? responseData.memberships as JsonRecord[]
      : [];

    return {
      authenticated: true,
      session: {
        identity: {
          userId,
          email,
          emailVerified: verified.body.email_verified === true,
        },
        memberships,
        accessToken,
        refreshToken,
        cookieHeaders,
      },
    };
  } catch {
    return { error: "company_service_unavailable", status: 503, cookieHeaders };
  }
}

export async function proxyOpointRequest(
  request: Request,
  path: string,
  options: { requireSameOrigin?: boolean; maxBodyBytes?: number } = {},
): Promise<Response> {
  if (options.requireSameOrigin && !hasSameOrigin(request)) {
    return jsonResponse({ error: "same_origin_required" }, 403);
  }

  const sessionResult = await getOtyaSession(request);
  if ("error" in sessionResult) {
    return jsonResponse({ error: sessionResult.error }, sessionResult.status, sessionResult.cookieHeaders);
  }
  if (!sessionResult.authenticated) {
    const headers = new Headers(sessionResult.cookieHeaders);
    return jsonResponse({ error: "authentication_required" }, 401, headers);
  }

  const bindings = await getOtyaWorkerBindings();
  if (!bindings?.OPOINT_API) {
    return jsonResponse({ error: "company_service_unavailable" }, 503, sessionResult.session.cookieHeaders);
  }

  let body: string | undefined;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const parsed = await readJsonBody(request, options.maxBodyBytes ?? 8_192);
    if ("error" in parsed) {
      return jsonResponse({ error: parsed.error }, parsed.status, sessionResult.session.cookieHeaders);
    }
    body = JSON.stringify(parsed.value);
  }

  const sourceUrl = new URL(request.url);
  const target = new URL(`https://opoint${path}`);
  target.search = sourceUrl.search;
  const headers = new Headers({
    authorization: `Bearer ${sessionResult.session.accessToken}`,
    accept: "application/json",
  });
  if (body !== undefined) headers.set("content-type", "application/json");

  try {
    const upstream = await bindings.OPOINT_API.fetch(new Request(target, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    }));
    const responseHeaders = new Headers(sessionResult.session.cookieHeaders);
    responseHeaders.set("cache-control", "private, no-store, max-age=0");
    responseHeaders.set("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    responseHeaders.set("x-content-type-options", "nosniff");
    responseHeaders.set("referrer-policy", "same-origin");
    return new Response(await upstream.text(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonResponse({ error: "company_service_unavailable" }, 503, sessionResult.session.cookieHeaders);
  }
}

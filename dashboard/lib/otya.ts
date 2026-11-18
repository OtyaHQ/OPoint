import { env as cloudflareEnv } from "cloudflare:workers";

type ServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnvironment = {
  OTYA_ID: ServiceBinding;
  OPOINT_API: ServiceBinding;
};

export const workerEnv = cloudflareEnv as unknown as WorkerEnvironment;

export const ACCESS_COOKIE = "__Host-opoint_access";
export const REFRESH_COOKIE = "__Host-opoint_refresh";
export const ACCESS_COOKIE_TTL = 15 * 60;
export const REFRESH_COOKIE_TTL = 30 * 24 * 60 * 60;

export type CookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): void;
};

export type OtyaIdentity = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
};

export type OtyaMembership = {
  membership_id: string;
  company_id: string;
  branch_id: string | null;
  display_name: string;
  email: string | null;
  role_key: string;
  status: "ACTIVE";
  company_slug: string;
  company_name: string;
  company_status: string;
  branch_name: string | null;
};

export type PendingMembership = {
  membership_id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  display_name: string;
  email: string | null;
  role_key: string;
  status: "PENDING";
  created_at: string;
};

export type BrowserSession = {
  accessToken: string;
  refreshToken: string;
  identity: OtyaIdentity;
  refreshed: boolean;
};

type IdentityCheck =
  | { kind: "valid"; identity: OtyaIdentity }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export function sessionCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export function setSessionCookies(jar: CookieJar, accessToken: string, refreshToken: string): void {
  jar.set(ACCESS_COOKIE, accessToken, sessionCookieOptions(ACCESS_COOKIE_TTL));
  jar.set(REFRESH_COOKIE, refreshToken, sessionCookieOptions(REFRESH_COOKIE_TTL));
}

export function clearSessionCookies(jar: CookieJar): void {
  jar.set(ACCESS_COOKIE, "", sessionCookieOptions(0));
  jar.set(REFRESH_COOKIE, "", sessionCookieOptions(0));
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function verifyAccessToken(accessToken: string): Promise<IdentityCheck> {
  try {
    const response = await workerEnv.OTYA_ID.fetch(new Request("https://auth/auth/verify", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    }));

    if (response.status === 401 || response.status === 403) return { kind: "invalid" };
    if (!response.ok) return { kind: "unavailable" };

    const data = await jsonBody(response);
    if (data.ok !== true || typeof data.user_id !== "string" || !data.user_id.trim()) {
      return { kind: "invalid" };
    }

    return {
      kind: "valid",
      identity: {
        userId: data.user_id,
        email: typeof data.email === "string" ? data.email : null,
        emailVerified: data.email_verified === true || data.email_verified === 1 || data.email_verified === "true",
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function loadBrowserSession(jar: CookieJar): Promise<
  | { kind: "authenticated"; session: BrowserSession }
  | { kind: "anonymous" }
  | { kind: "unavailable" }
> {
  let accessToken = jar.get(ACCESS_COOKIE)?.value ?? "";
  const refreshToken = jar.get(REFRESH_COOKIE)?.value ?? "";
  if (!accessToken && !refreshToken) return { kind: "anonymous" };

  let identity: OtyaIdentity | null = null;
  let refreshed = false;

  if (accessToken) {
    const current = await verifyAccessToken(accessToken);
    if (current.kind === "unavailable") return { kind: "unavailable" };
    if (current.kind === "valid") identity = current.identity;
  }

  if (!identity) {
    if (!refreshToken) return { kind: "anonymous" };
    try {
      const response = await workerEnv.OTYA_ID.fetch(new Request("https://auth/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(8000),
      }));
      if (response.status === 401 || response.status === 403) return { kind: "anonymous" };
      if (!response.ok) return { kind: "unavailable" };

      const data = await jsonBody(response);
      accessToken = typeof data.access_token === "string" ? data.access_token : "";
      if (!accessToken) return { kind: "anonymous" };

      const renewed = await verifyAccessToken(accessToken);
      if (renewed.kind === "unavailable") return { kind: "unavailable" };
      if (renewed.kind !== "valid") return { kind: "anonymous" };

      identity = renewed.identity;
      refreshed = true;
      // Otya ID currently extends the existing refresh credential; it does not
      // return a rotated token. Reset the host-only cookie expiry with that
      // same token after the Auth service confirms a successful refresh.
      setSessionCookies(jar, accessToken, refreshToken);
    } catch {
      return { kind: "unavailable" };
    }
  }

  if (!identity || !accessToken || !refreshToken) return { kind: "anonymous" };
  return {
    kind: "authenticated",
    session: { accessToken, refreshToken, identity, refreshed },
  };
}

export async function fetchOtyaMe(accessToken: string): Promise<{
  memberships: OtyaMembership[];
  pendingMemberships: PendingMembership[];
}> {
  const headers = { Authorization: "Bearer " + accessToken, Accept: "application/json" };
  const [activeResponse, pendingResponse] = await Promise.all([
    workerEnv.OPOINT_API.fetch(new Request("https://opoint.internal/v1/me", { headers })),
    workerEnv.OPOINT_API.fetch(new Request("https://opoint.internal/v1/me/pending-memberships", { headers })),
  ]);

  if (!activeResponse.ok || !pendingResponse.ok) {
    throw new Error("OtyaPoint membership service is unavailable");
  }

  const [active, pending] = await Promise.all([jsonBody(activeResponse), jsonBody(pendingResponse)]);
  const activeData = Array.isArray((active.data as Record<string, unknown> | undefined)?.memberships)
    ? (active.data as { memberships: OtyaMembership[] }).memberships
    : [];
  const pendingData = Array.isArray(pending.data)
    ? pending.data as PendingMembership[]
    : [];

  return { memberships: activeData, pendingMemberships: pendingData };
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

export async function readJsonLimited(
  request: Request,
  maxBytes = 8192,
): Promise<{ value: Record<string, unknown> } | { error: string; status: number }> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "invalid_json_object", status: 400 };
    }
    return { value: value as Record<string, unknown> };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

export async function callOtyaAuth(path: string, init: RequestInit): Promise<Response> {
  return workerEnv.OTYA_ID.fetch(new Request("https://auth" + path, {
    ...init,
    headers: new Headers({
      Accept: "application/json",
      ...(init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers || {}),
    }),
  }));
}

export async function callOpoint(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + accessToken);
  headers.set("Accept", "application/json");
  return workerEnv.OPOINT_API.fetch(new Request("https://opoint.internal" + path, {
    ...init,
    headers,
  }));
}

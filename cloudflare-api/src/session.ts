type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};
type D1Database = { prepare(query: string): D1Statement };
type AuthBinding = { fetch(request: Request): Promise<Response> };
type Env = { DB: D1Database; AUTH?: AuthBinding };
type Role = "SOVEREIGN" | "ATTENDANT" | "MANAGER" | "MANAGING_DIRECTOR" | "CHAIRMAN";
type Staff = {
  id: string;
  identity_subject: string;
  company_id: string;
  role: Role;
  status: string;
  display_name: string;
  agent_id: string | null;
};

const COOKIE_ACCESS = "__Host-otya_access";
const COOKIE_REFRESH = "__Secure-otya_refresh";
const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value.length <= 8192 ? value : null;
    }
  }
  return null;
}

function setSessionCookies(response: Response, accessToken: string, refreshToken?: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", COOKIE_ACCESS + "=" + accessToken + "; Path=/; Max-Age=" + ACCESS_MAX_AGE + "; Secure; HttpOnly; SameSite=Strict");
  if (refreshToken) {
    headers.append("set-cookie", COOKIE_REFRESH + "=" + refreshToken + "; Path=/api/v1/session; Max-Age=" + REFRESH_MAX_AGE + "; Secure; HttpOnly; SameSite=Strict");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function clearSessionCookies(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", COOKIE_ACCESS + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
  headers.append("set-cookie", COOKIE_REFRESH + "=; Path=/api/v1/session; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function authRequest(env: Env, path: string, method: "GET" | "POST", body?: unknown, accessToken?: string): Promise<Response> {
  if (!env.AUTH) throw new Error("AUTH_BINDING_MISSING");
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", "Bearer " + accessToken);
  return env.AUTH.fetch(new Request("https://auth" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  }));
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function resolveActiveStaff(env: Env, accessToken: string): Promise<Staff | null> {
  const verifiedResponse = await authRequest(env, "/auth/verify", "GET", undefined, accessToken);
  if (!verifiedResponse.ok) return null;
  const verified = await readJson(verifiedResponse);
  if (verified?.ok !== true || typeof verified.user_id !== "string") return null;
  const staff = await env.DB.prepare(
    "SELECT id,identity_subject,company_id,role,status,display_name,agent_id FROM omni_staff_memberships WHERE identity_subject=?1 LIMIT 1"
  ).bind(verified.user_id).first<Staff>();
  if (!staff || staff.status !== "ACTIVE" ||
      !["SOVEREIGN", "ATTENDANT", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"].includes(staff.role)) return null;
  return staff;
}

async function login(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!sameOriginPost(request)) return json({ error: "same_origin_request_required" }, 403);
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 8 * 1024) return json({ error: "request_too_large" }, 413);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ error: "content_type_must_be_json" }, 415);

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "invalid_body" }, 400);
    body = value as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 254 || password.length < 1 || password.length > 1024) {
    return json({ error: "invalid_credentials" }, 400);
  }

  try {
    const response = await authRequest(env, "/auth/login", "POST", { email, password });
    const result = await readJson(response);
    if (!response.ok || typeof result?.access_token !== "string" || typeof result.refresh_token !== "string") {
      const status = response.status === 429 ? 429 : response.status === 503 ? 503 : 401;
      return json({ error: status === 429 ? "too_many_login_attempts" : "invalid_email_or_password" }, status);
    }

    const accessToken = result.access_token;
    const refreshToken = result.refresh_token;
    const staff = await resolveActiveStaff(env, accessToken);
    if (!staff) {
      await authRequest(env, "/auth/logout", "POST", { refresh_token: refreshToken }).catch(() => null);
      return json({ error: "active_company_staff_membership_required" }, 403);
    }

    const safe = json({
      data: {
        id: staff.id,
        displayName: staff.display_name,
        role: staff.role,
        agentId: staff.agent_id,
        companyId: staff.company_id
      },
      requestId
    });
    return setSessionCookies(safe, accessToken, refreshToken);
  } catch {
    return json({ error: "authentication_service_unavailable" }, 503);
  }
}

async function refresh(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!sameOriginPost(request)) return json({ error: "same_origin_request_required" }, 403);
  const refreshToken = getCookie(request, COOKIE_REFRESH);
  if (!refreshToken) return clearSessionCookies(json({ error: "session_expired" }, 401));
  try {
    const response = await authRequest(env, "/auth/refresh", "POST", { refresh_token: refreshToken });
    const result = await readJson(response);
    if (!response.ok || typeof result?.access_token !== "string") {
      await authRequest(env, "/auth/logout", "POST", { refresh_token: refreshToken }).catch(() => null);
      return clearSessionCookies(json({ error: "session_expired" }, 401));
    }
    const accessToken = result.access_token;
    const staff = await resolveActiveStaff(env, accessToken);
    if (!staff) {
      await authRequest(env, "/auth/logout", "POST", { refresh_token: refreshToken }).catch(() => null);
      return clearSessionCookies(json({ error: "active_company_staff_membership_required" }, 403));
    }
    const safe = json({
      data: { id: staff.id, displayName: staff.display_name, role: staff.role, agentId: staff.agent_id, companyId: staff.company_id },
      requestId
    });
    return setSessionCookies(safe, accessToken);
  } catch {
    return json({ error: "authentication_service_unavailable" }, 503);
  }
}

async function logout(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!sameOriginPost(request)) return json({ error: "same_origin_request_required" }, 403);
  const refreshToken = getCookie(request, COOKIE_REFRESH);
  if (refreshToken && env.AUTH) {
    await authRequest(env, "/auth/logout", "POST", { refresh_token: refreshToken }).catch(() => null);
  }
  return clearSessionCookies(json({ data: { signedOut: true }, requestId }));
}

async function currentSession(request: Request, env: Env, requestId: string): Promise<Response> {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : getCookie(request, COOKIE_ACCESS);
  if (!accessToken || accessToken.length > 8192) return json({ error: "unauthorized" }, 401);
  try {
    const staff = await resolveActiveStaff(env, accessToken);
    if (!staff) return json({ error: "staff_access_denied" }, 403);
    return json({
      data: { id: staff.id, displayName: staff.display_name, role: staff.role, agentId: staff.agent_id, companyId: staff.company_id },
      requestId
    });
  } catch {
    return json({ error: "authentication_service_unavailable" }, 503);
  }
}

export async function handleSessionRoutes(request: Request, env: Env, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/v1/session/login") return login(request, env, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/session/refresh") return refresh(request, env, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/session/logout") return logout(request, env, requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/session/me") return currentSession(request, env, requestId);
  return null;
}

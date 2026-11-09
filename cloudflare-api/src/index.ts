import { saleRequestFingerprint } from "./sale-fingerprint.mjs";

interface D1Result<T> { results: T[] }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<T[]>;
}
export interface Env {
  DB: D1Database;
  AUTH?: { fetch(request: Request): Promise<Response> };
  OTYAPOINT_BOOTSTRAP_SECRET?: string;
  OTYAPOINT_INVITE_SERVICE_TOKEN?: string;
  OTYAPOINT_COMPANY_ID?: string;
}
type Role = "SOVEREIGN" | "ATTENDANT" | "MANAGER" | "MANAGING_DIRECTOR" | "CHAIRMAN";
type Staff = { id: string; identity_subject: string; company_id: string; branch_id: string | null; role: Role; status: string; display_name: string; email: string | null; agent_id: string | null; verified_email?: string | null };
const roles: Role[] = ["SOVEREIGN", "ATTENDANT", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
  }
});
const uuid = () => crypto.randomUUID();
const safeText = (value: unknown, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const int = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min ? Number(value) : null;
const isRole = (value: unknown): value is Role => typeof value === "string" && roles.includes(value as Role);
const canManage = (staff: Staff) => ["SOVEREIGN", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"].includes(staff.role);
const isResponse = (value: Staff | Response): value is Response => value instanceof Response;
const isSovereign = (staff: Staff) => staff.role === "SOVEREIGN";
const assignableRoles: Role[] = ["ATTENDANT", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"];
const staffStatuses = ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"] as const;

async function verifyOtyaIdentity(accessToken: string, env: Env): Promise<{ user_id: string; email: string | null } | null> {
  if (!env.AUTH || !accessToken.startsWith("Bearer ") || accessToken.length > 8192) return null;
  try {
    const response = await env.AUTH.fetch(new Request("https://auth/auth/verify", {
      method: "GET",
      headers: { Authorization: accessToken, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    }));
    if (!response.ok) return null;
    const verified = await response.json() as { ok?: boolean; user_id?: unknown; email?: unknown };
    if (verified.ok !== true || typeof verified.user_id !== "string" || !verified.user_id.trim()) return null;
    return {
      user_id: verified.user_id,
      email: typeof verified.email === "string" && verified.email.trim() ? verified.email.trim().toLowerCase() : null,
    };
  } catch {
    return null;
  }
}

async function matchesBootstrapSecret(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected || provided.length > 512 || expected.length > 512) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function newInvitationToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

async function deliverStaffInvitation(
  env: Env,
  invitation: { invitationId: string; email: string; displayName: string; role: Role; token: string; expiresAt: string },
): Promise<boolean> {
  if (!env.AUTH || !env.OTYAPOINT_INVITE_SERVICE_TOKEN || env.OTYAPOINT_INVITE_SERVICE_TOKEN.length < 32) return false;
  try {
    const response = await env.AUTH.fetch(new Request("https://auth/internal/notifications/omnipoint/staff-invitation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otya-service": "otyapoint",
        "x-otya-service-token": env.OTYAPOINT_INVITE_SERVICE_TOKEN,
      },
      body: JSON.stringify(invitation),
      signal: AbortSignal.timeout(10000),
    }));
    if (!response.ok) return false;
    const result = await response.json() as { accepted?: boolean };
    return result.accepted === true;
  } catch {
    return false;
  }
}

async function authenticate(request: Request, env: Env): Promise<Staff | Response> {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ") || header.length > 8192) return json({ error: "unauthorized" }, 401);
  if (!env.AUTH) return json({ error: "auth_service_unavailable" }, 503);
  try {
    const verifiedResponse = await env.AUTH.fetch(new Request("https://auth/auth/verify", {
      method: "GET",
      headers: { Authorization: header, Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    }));
    if (!verifiedResponse.ok) return json({ error: "unauthorized" }, 401);
    const verified = await verifiedResponse.json() as { ok?: boolean; user_id?: unknown; email?: unknown };
    if (verified.ok !== true || typeof verified.user_id !== "string" || !verified.user_id.trim()) {
      return json({ error: "unauthorized" }, 401);
    }
    const staff = await env.DB.prepare(
      "SELECT id, identity_subject, company_id, branch_id, role, status, display_name, email, agent_id FROM omni_staff_memberships WHERE identity_subject = ?1 LIMIT 1"
    ).bind(verified.user_id).first<Staff>();
    if (!staff || staff.status !== "ACTIVE" || !isRole(staff.role)) return json({ error: "staff_access_denied" }, 403);
    return { ...staff, verified_email: typeof verified.email === "string" ? verified.email : null };
  } catch {
    return json({ error: "auth_service_unavailable" }, 503);
  }
}
async function audit(env: Env, actor: string, action: string, entityType: string, entityId: string | null, reason: string | null, before: unknown, after: unknown, requestId: string) {
  await env.DB.prepare(
    "INSERT INTO omni_audit_events (id, actor_id, action, entity_type, entity_id, reason, before_state, after_state, request_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
  ).bind(uuid(), actor, action, entityType, entityId, reason, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), requestId).run();
}
function requestId(request: Request) { return request.headers.get("cf-ray") || uuid(); }

async function parseBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ error: "content_type_must_be_json" }, 415);
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 64 * 1024) return json({ error: "request_too_large" }, 413);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_body" }, 400);
    return body as Record<string, unknown>;
  } catch { return json({ error: "invalid_json" }, 400); }
}
const isBodyResponse = (value: Record<string, unknown> | Response): value is Response => value instanceof Response;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rid = requestId(request);
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const found = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'omni_%'").all<{ name: string }>();
        const expected = ["omni_products", "omni_retail_sales", "omni_retail_sale_lines", "omni_stock_movements", "omni_agency_transactions", "omni_ledger_entries", "omni_reconciliation_sessions", "omni_audit_events", "omni_staff_memberships"];
        const names = new Set(found.results.map(row => row.name));
        const ready = expected.every(name => names.has(name));
        return json({ service: "omnipoint-api", status: ready ? "ok" : "schema_not_ready", schemaReady: ready, requestId: rid }, ready ? 200 : 503);
      } catch {
        return json({ service: "omnipoint-api", status: "database_unavailable", requestId: rid }, 503);
      }
    }
    if (request.method === "OPTIONS") return json({ error: "cors_not_enabled" }, 405);

    // One-time owner bootstrap. This path is disabled until a high-entropy
    // secret is provisioned directly in the isolated Cloudflare Worker.
    // Otya Auth still verifies the owner identity; the bootstrap secret never
    // substitutes for identity authentication.
    if (request.method === "POST" && url.pathname === "/api/bootstrap/sovereign") {
      const expectedSecret = env.OTYAPOINT_BOOTSTRAP_SECRET || "";
      if (expectedSecret.length < 32) return json({ error: "owner_bootstrap_not_configured" }, 503);
      const providedSecret = request.headers.get("x-otyapoint-bootstrap-key") || "";
      if (!(await matchesBootstrapSecret(providedSecret, expectedSecret))) return json({ error: "forbidden" }, 403);

      const identity = await verifyOtyaIdentity(request.headers.get("authorization") || "", env);
      if (!identity) return json({ error: "identity_verification_failed" }, 401);
      const body = await parseBody(request);
      if (isBodyResponse(body)) return body;

      const companyId = safeText(env.OTYAPOINT_COMPANY_ID, 64) || "omnipoint-default";
      const existing = await env.DB.prepare(
        "SELECT id FROM omni_audit_events WHERE company_id=?1 AND action='BOOTSTRAP_OWNER' LIMIT 1"
      ).bind(companyId).first<{ id: string }>();
      if (existing) return json({ error: "owner_bootstrap_already_consumed" }, 409);

      const ownerId = uuid();
      const displayName = safeText(body.displayName, 120) || identity.email?.split("@")[0] || "OtyaPoint Owner";
      try {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO omni_staff_memberships (id,identity_subject,company_id,branch_id,role,status,created_by,display_name,email) VALUES (?1,?2,?3,NULL,'SOVEREIGN','ACTIVE',?4,?5,?6)"
          ).bind(ownerId, identity.user_id, companyId, "one-time-owner-bootstrap", displayName, identity.email),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'BOOTSTRAP_OWNER','STAFF_MEMBERSHIP',?3,'One-time owner bootstrap completed',?4,?5,?6)"
          ).bind(uuid(), ownerId, ownerId, JSON.stringify({ role: "SOVEREIGN", status: "ACTIVE" }), rid, companyId),
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return json({ error: "owner_already_provisioned" }, 409);
        }
        throw error;
      }
      return json({ data: { id: ownerId, displayName, email: identity.email, role: "SOVEREIGN", status: "ACTIVE" }, requestId: rid }, 201);
    }

    // Invitation acceptance is an authenticated identity operation, not a staff
    // operation: the invited user does not yet have an OmniPoint membership.
    if (request.method === "POST" && url.pathname === "/api/staff/invitations/accept") {
      const identity = await verifyOtyaIdentity(request.headers.get("authorization") || "", env);
      if (!identity) return json({ error: "identity_verification_failed" }, 401);
      if (!identity.email) return json({ error: "verified_email_required" }, 403);
      const body = await parseBody(request);
      if (isBodyResponse(body)) return body;
      const token = safeText(body.token, 128).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "invalid_invitation_token" }, 400);
      const digest = await sha256Hex(token);
      const invitation = await env.DB.prepare(
        "SELECT id,company_id,email,display_name,branch_id,role,agent_id,status,expires_at FROM omni_staff_invitations WHERE token_digest=?1 LIMIT 1"
      ).bind(digest).first<{
        id: string; company_id: string; email: string; display_name: string;
        branch_id: string | null; role: Role; agent_id: string | null;
        status: string; expires_at: string;
      }>();
      if (!invitation) return json({ error: "invitation_not_found" }, 404);
      if (invitation.status !== "PENDING") return json({ error: "invitation_not_pending" }, 409);
      const expiration = Date.parse(invitation.expires_at);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        await env.DB.prepare(
          "UPDATE omni_staff_invitations SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='PENDING'"
        ).bind(invitation.id).run();
        return json({ error: "invitation_expired" }, 410);
      }
      if (identity.email.toLowerCase() !== invitation.email.toLowerCase()) {
        return json({ error: "invitation_email_mismatch" }, 403);
      }
      const existing = await env.DB.prepare(
        "SELECT id FROM omni_staff_memberships WHERE identity_subject=?1 LIMIT 1"
      ).bind(identity.user_id).first<{ id: string }>();
      if (existing) return json({ error: "staff_membership_already_exists" }, 409);

      const memberId = uuid();
      const requestTime = new Date().toISOString();
      try {
        await env.DB.batch([
          // Insert the referenced membership before linking it from the invitation
          // so SQLite foreign-key enforcement remains valid within the batch.
          env.DB.prepare(
            "INSERT INTO omni_staff_memberships (id,identity_subject,company_id,branch_id,role,status,created_by,display_name,email,agent_id) VALUES (?1,?2,?3,?4,?5,'PENDING',?6,?7,?8,?9)"
          ).bind(memberId, identity.user_id, invitation.company_id, invitation.branch_id, invitation.role, "staff-invitation:" + invitation.id + ":" + digest, invitation.display_name, identity.email, invitation.agent_id),
          env.DB.prepare(
            "UPDATE omni_staff_invitations SET status='ACCEPTED',accepted_staff_id=?1,accepted_at=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3 AND status='PENDING' AND token_digest=?4"
          ).bind(memberId, requestTime, invitation.id, digest),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'ACCEPT_STAFF_INVITATION','STAFF_INVITATION',?3,'Invited Otya identity accepted the invitation',?4,?5,?6)"
          ).bind(uuid(), memberId, invitation.id, JSON.stringify({ membershipStatus: "PENDING", role: invitation.role }), rid, invitation.company_id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_STAFF_MEMBERSHIP','STAFF_MEMBERSHIP',?3,'Invitation acceptance created a pending staff membership',?4,?5,?6)"
          ).bind(uuid(), memberId, memberId, JSON.stringify({ status: "PENDING", role: invitation.role, branchId: invitation.branch_id }), rid, invitation.company_id),
        ]);
      } catch (error) {
        if (error instanceof Error && (
          error.message.includes("UNIQUE constraint failed")
          || error.message.includes("STAFF_INVITATION_NOT_PENDING")
        )) {
          return json({ error: "invitation_already_accepted_or_membership_exists" }, 409);
        }
        throw error;
      }
      return json({
        data: {
          id: memberId,
          displayName: invitation.display_name,
          email: identity.email,
          branchId: invitation.branch_id,
          role: invitation.role,
          status: "PENDING",
        },
        message: "Invitation accepted. The OtyaPoint owner must activate your membership before you can access shop operations.",
        requestId: rid,
      }, 201);
    }

    const staff = await authenticate(request, env);
    if (isResponse(staff)) return staff;

    try {
      if (request.method === "GET" && url.pathname === "/api/me") {
        return json({
          data: {
            id: staff.id,
            identitySubject: staff.identity_subject,
            companyId: staff.company_id,
            branchId: staff.branch_id,
            role: staff.role,
            status: staff.status,
            displayName: staff.display_name || staff.verified_email || staff.email || staff.identity_subject,
            email: staff.verified_email || staff.email,
            agentId: staff.agent_id
          },
          requestId: rid
        });
      }

      if (request.method === "GET" && url.pathname === "/api/staff") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);
        const status = url.searchParams.get("status");
        if (status && !staffStatuses.includes(status as typeof staffStatuses[number])) {
          return json({ error: "invalid_staff_status" }, 400);
        }
        const query = status
          ? env.DB.prepare(
              "SELECT id,display_name,email,agent_id,branch_id,role,status,created_at,updated_at FROM omni_staff_memberships WHERE company_id=?1 AND status=?2 ORDER BY created_at ASC LIMIT 250"
            ).bind(staff.company_id, status)
          : env.DB.prepare(
              "SELECT id,display_name,email,agent_id,branch_id,role,status,created_at,updated_at FROM omni_staff_memberships WHERE company_id=?1 ORDER BY created_at ASC LIMIT 250"
            ).bind(staff.company_id);
        const result = await query.all();
        return json({ data: result.results, requestId: rid });
      }

      // Staff administration is invitation-based. Owners never ask another user
      // to share an Otya bearer token; the invitee accepts with their own login.
      if (request.method === "GET" && url.pathname === "/api/staff/invitations") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const result = await env.DB.prepare(
          "SELECT id,email,display_name,branch_id,role,agent_id,status,delivery_status,expires_at,accepted_staff_id,accepted_at,created_at,updated_at FROM omni_staff_invitations WHERE company_id=?1 ORDER BY created_at DESC LIMIT 250"
        ).bind(staff.company_id).all();
        return json({ data: result.results, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/staff/invitations") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const email = safeText(body.email, 254).toLowerCase();
        const role = safeText(body.role, 32) as Role;
        const displayName = safeText(body.displayName, 120) || email.split("@")[0] || "OtyaPoint Staff";
        const branchId = body.branchId == null ? null : safeText(body.branchId, 64);
        const agentId = body.agentId == null ? null : safeText(body.agentId, 40).toUpperCase();
        if (!validEmail(email) || !assignableRoles.includes(role)) {
          return json({ error: "valid_email_and_assignable_role_required" }, 400);
        }
        if (body.branchId != null && !branchId) return json({ error: "invalid_branch_id" }, 400);
        if (agentId && !/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(agentId)) return json({ error: "invalid_agent_id" }, 400);
        if (staff.email && staff.email.toLowerCase() === email) return json({ error: "owner_cannot_invite_self" }, 409);

        const memberExists = await env.DB.prepare(
          "SELECT id FROM omni_staff_memberships WHERE company_id=?1 AND lower(email)=?2 LIMIT 1"
        ).bind(staff.company_id, email).first<{ id: string }>();
        if (memberExists) return json({ error: "staff_membership_already_exists" }, 409);
        const invitationExists = await env.DB.prepare(
          "SELECT id FROM omni_staff_invitations WHERE company_id=?1 AND lower(email)=?2 AND status='PENDING' LIMIT 1"
        ).bind(staff.company_id, email).first<{ id: string }>();
        if (invitationExists) return json({ error: "pending_invitation_already_exists" }, 409);

        const invitationId = uuid();
        const token = newInvitationToken();
        const tokenDigest = await sha256Hex(token);
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_staff_invitations (id,company_id,email,display_name,branch_id,role,agent_id,token_digest,status,delivery_status,invited_by,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'PENDING','PENDING',?9,?10)"
            ).bind(invitationId, staff.company_id, email, displayName, branchId, role, agentId, tokenDigest, staff.id, expiresAt),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_STAFF_INVITATION','STAFF_INVITATION',?3,'Owner created an email-bound staff invitation',?4,?5,?6)"
            ).bind(uuid(), staff.id, invitationId, JSON.stringify({ email, role, branchId, agentId, expiresAt }), rid, staff.company_id),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            return json({ error: "pending_invitation_conflict" }, 409);
          }
          throw error;
        }

        const sent = await deliverStaffInvitation(env, { invitationId, email, displayName, role, token, expiresAt });
        const deliveryStatus = sent ? "SENT" : "FAILED";
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE omni_staff_invitations SET delivery_status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3"
          ).bind(deliveryStatus, invitationId, staff.company_id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,?3,'STAFF_INVITATION',?4,?5,?6,?7,?8)"
          ).bind(uuid(), staff.id, sent ? "DELIVER_STAFF_INVITATION" : "STAFF_INVITATION_DELIVERY_FAILED", invitationId, sent ? "Invitation accepted by the Otya email service" : "Invitation email delivery failed", JSON.stringify({ deliveryStatus }), rid, staff.company_id),
        ]);
        return json({
          data: { id: invitationId, email, displayName, role, branchId, agentId, status: "PENDING", deliveryStatus, expiresAt },
          ...(sent ? {} : { message: "Invitation was saved but email delivery failed. Use the resend action after resolving the mail service issue." }),
          requestId: rid,
        }, sent ? 201 : 202);
      }

      const invitationAction = url.pathname.match(/^\/api\/staff\/invitations\/([^/]+)\/(resend|revoke)$/);
      if (request.method === "POST" && invitationAction) {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const invitationId = safeText(invitationAction[1], 64);
        const action = invitationAction[2];
        const invitation = await env.DB.prepare(
          "SELECT id,email,display_name,role,branch_id,agent_id,status,expires_at FROM omni_staff_invitations WHERE id=?1 AND company_id=?2 LIMIT 1"
        ).bind(invitationId, staff.company_id).first<{
          id: string; email: string; display_name: string; role: Role;
          branch_id: string | null; agent_id: string | null; status: string; expires_at: string;
        }>();
        if (!invitation) return json({ error: "invitation_not_found" }, 404);
        if (invitation.status !== "PENDING") return json({ error: "invitation_not_pending" }, 409);

        if (action === "revoke") {
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE omni_staff_invitations SET status='REVOKED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND company_id=?2 AND status='PENDING'"
            ).bind(invitationId, staff.company_id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'REVOKE_STAFF_INVITATION','STAFF_INVITATION',?3,'Owner revoked the pending invitation',?4,?5,?6)"
            ).bind(uuid(), staff.id, invitationId, JSON.stringify({ status: "REVOKED" }), rid, staff.company_id),
          ]);
          return json({ data: { id: invitationId, status: "REVOKED" }, requestId: rid });
        }

        const expiration = Date.parse(invitation.expires_at);
        if (!Number.isFinite(expiration) || expiration <= Date.now()) {
          await env.DB.prepare(
            "UPDATE omni_staff_invitations SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND company_id=?2 AND status='PENDING'"
          ).bind(invitationId, staff.company_id).run();
          return json({ error: "invitation_expired" }, 410);
        }

        const token = newInvitationToken();
        const tokenDigest = await sha256Hex(token);
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE omni_staff_invitations SET token_digest=?1,expires_at=?2,delivery_status='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=?3 AND company_id=?4 AND status='PENDING'"
          ).bind(tokenDigest, expiresAt, invitationId, staff.company_id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RESEND_STAFF_INVITATION','STAFF_INVITATION',?3,'Owner rotated the one-time invitation token',?4,?5,?6)"
          ).bind(uuid(), staff.id, invitationId, JSON.stringify({ expiresAt }), rid, staff.company_id),
        ]);
        const sent = await deliverStaffInvitation(env, {
          invitationId,
          email: invitation.email,
          displayName: invitation.display_name,
          role: invitation.role,
          token,
          expiresAt,
        });
        const deliveryStatus = sent ? "SENT" : "FAILED";
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE omni_staff_invitations SET delivery_status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3"
          ).bind(deliveryStatus, invitationId, staff.company_id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,?3,'STAFF_INVITATION',?4,?5,?6,?7,?8)"
          ).bind(uuid(), staff.id, sent ? "DELIVER_STAFF_INVITATION" : "STAFF_INVITATION_DELIVERY_FAILED", invitationId, sent ? "Replacement invitation accepted by Otya email service" : "Replacement invitation email delivery failed", JSON.stringify({ deliveryStatus, expiresAt }), rid, staff.company_id),
        ]);
        return json({ data: { id: invitationId, status: "PENDING", deliveryStatus, expiresAt }, requestId: rid }, sent ? 200 : 202);
      }

      if (request.method === "POST" && url.pathname === "/api/staff") {
        return json({ error: "staff_invitation_required", invitationEndpoint: "/api/staff/invitations" }, 410);
      }

      // Membership changes are deliberately owner-only. SOVEREIGN role
      // assignment is not exposed by this endpoint, and revoked memberships
      // cannot be reactivated.
      if (request.method === "PATCH" && url.pathname.startsWith("/api/staff/")) {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const memberId = safeText(url.pathname.slice("/api/staff/".length), 64);
        if (!memberId || memberId.includes("/")) return json({ error: "invalid_staff_id" }, 400);
        if (memberId === staff.id) return json({ error: "cannot_modify_own_membership" }, 409);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;

        const target = await env.DB.prepare(
          "SELECT id,role,status,branch_id,display_name,agent_id FROM omni_staff_memberships WHERE id=?1 AND company_id=?2 LIMIT 1"
        ).bind(memberId, staff.company_id).first<{ id: string; role: Role; status: string; branch_id: string | null; display_name: string; agent_id: string | null }>();
        if (!target) return json({ error: "staff_member_not_found" }, 404);
        if (target.role === "SOVEREIGN") return json({ error: "sovereign_membership_is_protected" }, 403);
        if (target.status === "REVOKED") return json({ error: "revoked_membership_is_final" }, 409);

        const updates: string[] = [];
        const values: unknown[] = [];
        const after: Record<string, unknown> = {};
        if (body.role !== undefined) {
          const role = safeText(body.role, 32) as Role;
          if (!assignableRoles.includes(role)) return json({ error: "invalid_assignable_role" }, 400);
          updates.push("role=?" + (values.length + 1));
          values.push(role);
          after.role = role;
        }
        if (body.status !== undefined) {
          const status = safeText(body.status, 16);
          if (!staffStatuses.includes(status as typeof staffStatuses[number])) return json({ error: "invalid_staff_status" }, 400);
          updates.push("status=?" + (values.length + 1));
          values.push(status);
          after.status = status;
        }
        if (body.branchId !== undefined) {
          const branchId = body.branchId == null ? null : safeText(body.branchId, 64);
          if (body.branchId != null && !branchId) return json({ error: "invalid_branch_id" }, 400);
          updates.push("branch_id=?" + (values.length + 1));
          values.push(branchId);
          after.branchId = branchId;
        }
        if (body.displayName !== undefined) {
          const displayName = safeText(body.displayName, 120);
          if (!displayName) return json({ error: "invalid_display_name" }, 400);
          updates.push("display_name=?" + (values.length + 1));
          values.push(displayName);
          after.displayName = displayName;
        }
        if (body.agentId !== undefined) {
          const agentId = body.agentId == null ? null : safeText(body.agentId, 40).toUpperCase();
          if (agentId && !/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(agentId)) return json({ error: "invalid_agent_id" }, 400);
          updates.push("agent_id=?" + (values.length + 1));
          values.push(agentId);
          after.agentId = agentId;
        }
        if (updates.length === 0) return json({ error: "no_staff_changes_supplied" }, 400);

        updates.push("updated_at=CURRENT_TIMESTAMP");
        values.push(memberId, staff.company_id);
        const before = { role: target.role, status: target.status, branchId: target.branch_id, displayName: target.display_name, agentId: target.agent_id };
        try {
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE omni_staff_memberships SET " + updates.join(",") + " WHERE id=?" + (values.length - 1) + " AND company_id=?" + values.length
            ).bind(...values),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_STAFF_MEMBERSHIP','STAFF_MEMBERSHIP',?3,'Owner updated staff access or profile',?4,?5,?6,?7)"
            ).bind(uuid(), staff.id, memberId, JSON.stringify(before), JSON.stringify(after), rid, staff.company_id),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "agent_id_already_assigned" }, 409);
          throw error;
        }
        return json({ data: { id: memberId, ...before, ...after }, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/products") {
        const result = await env.DB.prepare(
          "SELECT id, sku, name, description, category, cost_price, selling_price, quantity_on_hand, reorder_level, created_at, updated_at FROM omni_products WHERE is_active = 1 AND company_id = ?1 ORDER BY name LIMIT 500"
        ).bind(staff.company_id).all();
        return json({ data: result.results, count: result.results.length, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/summary") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);
        const [products, sales, agency, retailLedger, agencyLedger] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN quantity_on_hand <= reorder_level THEN 1 ELSE 0 END),0) AS low_stock FROM omni_products WHERE is_active=1 AND company_id=?1").bind(staff.company_id).first<{ count: number; low_stock: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM omni_retail_sales WHERE status='COMPLETED' AND company_id=?1").bind(staff.company_id).first<{ count: number; total: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN provider_status='SUCCEEDED' THEN amount ELSE 0 END),0) AS succeeded_amount FROM omni_agency_transactions WHERE company_id=?1").bind(staff.company_id).first<{ count: number; succeeded_amount: number }>(),
          env.DB.prepare("SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM omni_ledger_entries WHERE ledger_type='RETAIL' AND company_id=?1").bind(staff.company_id).first<{ debit: number; credit: number }>(),
          env.DB.prepare("SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM omni_ledger_entries WHERE ledger_type='FINTECH_AGENCY' AND company_id=?1").bind(staff.company_id).first<{ debit: number; credit: number }>()
        ]);
        return json({
          currency: "UGX",
          inventory: { activeProducts: products?.count || 0, lowStock: products?.low_stock || 0 },
          retail: { completedSales: sales?.count || 0, completedSalesTotal: sales?.total || 0, ledgerBalanced: (retailLedger?.debit || 0) === (retailLedger?.credit || 0) },
          agency: { transactions: agency?.count || 0, providerConfirmedAmount: agency?.succeeded_amount || 0, ledgerBalanced: (agencyLedger?.debit || 0) === (agencyLedger?.credit || 0) },
          demoData: false,
          requestId: rid
        });
      }

      if (request.method === "POST" && url.pathname === "/api/products") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request); if (isBodyResponse(body)) return body;
        const sku = safeText(body.sku, 64).toUpperCase();
        const name = safeText(body.name, 180);
        const category = safeText(body.category, 80) || "General";
        const cost = int(body.costPrice);
        const price = int(body.sellingPrice);
        const reorder = int(body.reorderLevel);
        if (!sku || !/^[A-Z0-9._-]{2,64}$/.test(sku) || !name || cost === null || price === null || reorder === null) return json({ error: "invalid_product" }, 400);
        const id = uuid();
        const product = { id, sku, name, category, costPrice: cost, sellingPrice: price, quantityOnHand: 0, reorderLevel: reorder };
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO omni_products (id,sku,name,description,category,cost_price,selling_price,quantity_on_hand,reorder_level,company_id) VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9)")
              .bind(id, sku, name, safeText(body.description, 1000) || null, category, cost, price, reorder, staff.company_id),
            env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE','PRODUCT',?3,'Product created',?4,?5,?6)")
              .bind(uuid(), staff.id, id, JSON.stringify(product), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "sku_conflict" }, 409);
          throw error;
        }
        return json({ data: product, requestId: rid }, 201);
      }

      if (request.method === "POST" && url.pathname === "/api/stock-adjustments") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request); if (isBodyResponse(body)) return body;
        const productId = safeText(body.productId, 64);
        const delta = Number.isSafeInteger(body.quantityDelta) ? Number(body.quantityDelta) : null;
        const reason = safeText(body.reason, 500);
        if (!productId || delta === null || delta === 0 || !reason) return json({ error: "invalid_stock_adjustment" }, 400);
        const product = await env.DB.prepare("SELECT id, sku, name, quantity_on_hand, cost_price, is_active FROM omni_products WHERE id=?1 AND company_id=?2").bind(productId, staff.company_id).first<{ id: string; sku: string; name: string; quantity_on_hand: number; cost_price: number; is_active: number }>();
        if (!product || product.is_active !== 1) return json({ error: "product_not_available" }, 404);
        const nextQuantity = Number(product.quantity_on_hand) + delta;
        if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) return json({ error: "insufficient_stock" }, 409);
        const movementId = uuid();
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO omni_stock_movements (id,product_id,actor_id,movement_type,quantity_delta,quantity_after,unit_cost,reference_type,reference_id,reason,company_id) VALUES (?1,?2,?3,'ADJUSTMENT',?4,?5,?6,'STOCK_ADJUSTMENT',?1,?7,?8)")
              .bind(movementId, productId, staff.id, delta, nextQuantity, product.cost_price, reason, staff.company_id),
            env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'ADJUST_STOCK','PRODUCT',?3,?4,?5,?6,?7,?8)")
              .bind(uuid(), staff.id, productId, reason, JSON.stringify({ quantityOnHand: product.quantity_on_hand }), JSON.stringify({ quantityOnHand: nextQuantity }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("INSUFFICIENT_STOCK") || error.message.includes("STOCK_MOVEMENT_MISMATCH"))) return json({ error: "stock_conflict_retry" }, 409);
          throw error;
        }
        return json({ data: { productId, quantityOnHand: nextQuantity, movementId }, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/sales") {
        if (!roles.includes(staff.role)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request); if (isBodyResponse(body)) return body;
        const idempotencyKey = safeText(request.headers.get("idempotency-key"), 128);
        const paymentMethod = safeText(body.paymentMethod, 20).toUpperCase();
        const lines = body.items;
        if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json({ error: "idempotency_key_required" }, 400);
        if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) return json({ error: "invalid_sale_items" }, 400);
        const normalized: Array<{ productId: string; quantity: number }> = [];
        const seen = new Set<string>();
        for (const raw of lines) {
          if (!raw || typeof raw !== "object") return json({ error: "invalid_sale_items" }, 400);
          const item = raw as Record<string, unknown>;
          const productId = safeText(item.productId, 64);
          const quantity = int(item.quantity, 1);
          if (!productId || quantity === null || quantity > 10000 || seen.has(productId)) return json({ error: "invalid_sale_items" }, 400);
          seen.add(productId); normalized.push({ productId, quantity });
        }
        const requestFingerprint = await saleRequestFingerprint(paymentMethod, normalized);
        const existing = await env.DB.prepare("SELECT id,receipt_number,total,status,request_fingerprint FROM omni_retail_sales WHERE idempotency_key=?1 AND company_id=?2").bind(idempotencyKey, staff.company_id).first<{ id: string; receipt_number: string; total: number; status: string; request_fingerprint: string | null }>();
        if (existing) {
          if (!existing.request_fingerprint || existing.request_fingerprint !== requestFingerprint) return json({ error: "idempotency_key_payload_conflict" }, 409);
          return json({ data: { id: existing.id, receipt_number: existing.receipt_number, total: existing.total, status: existing.status }, replayed: true, requestId: rid });
        }
        if (paymentMethod !== "CASH") return json({ error: "payment_method_not_enabled", allowed: ["CASH"] }, 422);
        const placeholders = normalized.map((_, i) => "?" + (i + 2)).join(",");
        const productRows = await env.DB.prepare(
          "SELECT id,sku,name,cost_price,selling_price,quantity_on_hand,is_active FROM omni_products WHERE company_id=?1 AND id IN (" + placeholders + ")"
        ).bind(staff.company_id, ...normalized.map(item => item.productId)).all<{ id: string; sku: string; name: string; cost_price: number; selling_price: number; quantity_on_hand: number; is_active: number }>();
        const productMap = new Map(productRows.results.map(product => [product.id, product]));
        if (productMap.size !== normalized.length) return json({ error: "product_not_available" }, 409);
        let subtotal = 0; let costOfGoods = 0;
        const saleId = uuid();
        const receiptNumber = "OP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + uuid().slice(0, 8).toUpperCase();
        const saleLines: Array<{ id: string; productId: string; sku: string; name: string; quantity: number; price: number; cost: number; total: number }> = [];
        for (const item of normalized) {
          const product = productMap.get(item.productId)!;
          if (product.is_active !== 1) return json({ error: "product_not_available" }, 409);
          const price = Number(product.selling_price); const cost = Number(product.cost_price);
          const lineTotal = price * item.quantity; const lineCost = cost * item.quantity;
          if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(lineCost)) return json({ error: "amount_overflow" }, 400);
          subtotal += lineTotal; costOfGoods += lineCost;
          saleLines.push({ id: uuid(), productId: product.id, sku: product.sku, name: product.name, quantity: item.quantity, price, cost, total: lineTotal });
        }
        if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(costOfGoods) || subtotal <= 0) return json({ error: "invalid_sale_total" }, 400);
        const statements: D1Statement[] = [
          env.DB.prepare("INSERT INTO omni_retail_sales (id,receipt_number,status,currency,subtotal,discount_total,tax_total,total,cost_of_goods,payment_method,idempotency_key,actor_id,company_id,request_fingerprint) VALUES (?1,?2,'COMPLETED','UGX',?3,0,0,?3,?4,'CASH',?5,?6,?7,?8)")
            .bind(saleId, receiptNumber, subtotal, costOfGoods, idempotencyKey, staff.id, staff.company_id, requestFingerprint)
        ];
        for (const line of saleLines) {
          statements.push(env.DB.prepare(
            "INSERT INTO omni_retail_sale_lines (id,sale_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,unit_cost,line_total) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
          ).bind(line.id, saleId, line.productId, line.sku, line.name, line.quantity, line.price, line.cost, line.total));
        }
        statements.push(
          env.DB.prepare("INSERT INTO omni_ledger_entries (id,ledger_type,account_code,currency,debit,credit,source_type,source_id,idempotency_key,description,company_id) VALUES (?1,'RETAIL','CASH_ON_HAND','UGX',?2,0,'RETAIL_SALE',?3,?4,'Cash received for retail sale',?7),(?5,'RETAIL','SALES_REVENUE','UGX',0,?2,'RETAIL_SALE',?3,?6,'Retail sales revenue',?7)")
            .bind(uuid(), subtotal, saleId, idempotencyKey + ":cash", uuid(), idempotencyKey + ":revenue", staff.company_id)
        );
        if (costOfGoods > 0) statements.push(
          env.DB.prepare("INSERT INTO omni_ledger_entries (id,ledger_type,account_code,currency,debit,credit,source_type,source_id,idempotency_key,description,company_id) VALUES (?1,'RETAIL','COST_OF_GOODS_SOLD','UGX',?2,0,'RETAIL_SALE',?3,?4,'Cost of goods sold',?7),(?5,'RETAIL','INVENTORY','UGX',0,?2,'RETAIL_SALE',?3,?6,'Inventory relieved at cost',?7)")
            .bind(uuid(), costOfGoods, saleId, idempotencyKey + ":cogs", uuid(), idempotencyKey + ":inventory", staff.company_id)
        );
        statements.push(env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'POST_SALE','RETAIL_SALE',?3,'Cash sale posted',?4,?5,?6)"
        ).bind(uuid(), staff.id, saleId, JSON.stringify({ receiptNumber, subtotal, costOfGoods, currency: "UGX" }), rid, staff.company_id));
        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("INSUFFICIENT_STOCK") || error.message.includes("PRODUCT_NOT_AVAILABLE"))) return json({ error: "stock_conflict_or_product_unavailable" }, 409);
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            const replay = await env.DB.prepare("SELECT id,receipt_number,total,status,request_fingerprint FROM omni_retail_sales WHERE idempotency_key=?1 AND company_id=?2").bind(idempotencyKey, staff.company_id).first<{ id: string; receipt_number: string; total: number; status: string; request_fingerprint: string | null }>();
            if (replay) {
              if (!replay.request_fingerprint || replay.request_fingerprint !== requestFingerprint) return json({ error: "idempotency_key_payload_conflict" }, 409);
              return json({ data: { id: replay.id, receipt_number: replay.receipt_number, total: replay.total, status: replay.status }, replayed: true, requestId: rid });
            }
            return json({ error: "duplicate_conflict" }, 409);
          }
          throw error;
        }
        return json({ data: { id: saleId, receiptNumber, subtotal, total: subtotal, currency: "UGX", status: "COMPLETED" }, requestId: rid }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/agency-readiness") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);

        // This is an operations snapshot of locally recorded rows only.
        // It never contacts a provider, creates a transaction, or posts a ledger entry.
        const [totals, pending, unknown, providers] = await Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1"
          ).bind(staff.company_id).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1 AND provider_status IN ('DRAFT','PENDING')"
          ).bind(staff.company_id).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1 AND provider_status = 'UNKNOWN'"
          ).bind(staff.company_id).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT provider, COUNT(*) AS transactions FROM omni_agency_transactions WHERE company_id=?1 GROUP BY provider ORDER BY provider"
          ).bind(staff.company_id).all<{ provider: string | null; transactions: number }>()
        ]);

        return json({
          service: "otyapoint-agency",
          currency: "UGX",
          mode: "LOCAL_RECORDS_ONLY",
          transactionCreation: "DISABLED_UNTIL_PROVIDER_ADAPTERS_AND_CONTROLS_ARE_VERIFIED",
          providers: [
            { id: "interswitch_marketplace_routing", status: "NOT_READY", adapter: "NOT_IMPLEMENTED" },
            { id: "quickteller_business", status: "NOT_READY", adapter: "NOT_IMPLEMENTED" },
            { id: "airtel_money", status: "NOT_READY", adapter: "NOT_IMPLEMENTED" },
            { id: "mtn_mobile_money", status: "NOT_READY", adapter: "NOT_IMPLEMENTED" }
          ],
          records: {
            total: totals?.total ?? 0,
            pending: pending?.total ?? 0,
            unknownOrNeedsReconciliation: unknown?.total ?? 0,
            byProvider: providers.results.map(row => ({
              provider: row.provider || "UNSPECIFIED",
              transactions: row.transactions
            }))
          },
          liveMoneyEnabled: false,
          requestId: rid
        });
      }

      if (request.method === "GET" && url.pathname === "/api/agency-overview") {
        // Read-only operations summary. Managers see company records; other
        // staff see only records they created. Only provider-confirmed records
        // contribute to the confirmed amount and commission totals.
        const scopeSql = canManage(staff)
          ? "company_id = ?1"
          : "company_id = ?1 AND actor_id = ?2";
        const scopeValues: unknown[] = [staff.company_id];
        if (!canManage(staff)) scopeValues.push(staff.id);

        const [totals, recent] = await Promise.all([
          env.DB.prepare(
            `SELECT COUNT(*) AS transaction_count,
                    COALESCE(SUM(CASE WHEN provider_status = 'SUCCEEDED' THEN amount ELSE 0 END), 0) AS confirmed_amount,
                    COALESCE(SUM(CASE WHEN provider_status = 'SUCCEEDED' THEN commission ELSE 0 END), 0) AS confirmed_commission,
                    COALESCE(SUM(CASE WHEN provider_status IN ('PENDING','UNKNOWN') THEN 1 ELSE 0 END), 0) AS needs_reconciliation,
                    COALESCE(SUM(CASE WHEN provider_status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed_count
               FROM omni_agency_transactions WHERE ${scopeSql}`
          ).bind(...scopeValues).first<{
            transaction_count: number;
            confirmed_amount: number;
            confirmed_commission: number;
            needs_reconciliation: number;
            failed_count: number;
          }>(),
          env.DB.prepare(
            `SELECT id, reference, transaction_type, provider, provider_status,
                    amount, commission, currency, created_at, updated_at
               FROM omni_agency_transactions
              WHERE ${scopeSql}
              ORDER BY created_at DESC
              LIMIT 10`
          ).bind(...scopeValues).all()
        ]);

        return json({
          source: "LOCAL_D1_RECORDS_ONLY",
          currency: "UGX",
          transactions: {
            count: totals?.transaction_count ?? 0,
            providerConfirmedAmount: totals?.confirmed_amount ?? 0,
            providerConfirmedCommission: totals?.confirmed_commission ?? 0,
            needsReconciliation: totals?.needs_reconciliation ?? 0,
            failed: totals?.failed_count ?? 0
          },
          recent: recent.results,
          scope: canManage(staff) ? "company" : "own",
          requestId: rid
        });
      }

      if (request.method === "GET" && url.pathname === "/api/agency-transactions") {
        const type = url.searchParams.get("type");
        const status = url.searchParams.get("status");
        const allowedTypes = ["CASH_IN", "CASH_OUT", "AIRTIME", "BILL_PAYMENT", "FLOAT_ADJUSTMENT", "REVERSAL"];
        const allowedStatuses = ["DRAFT", "PENDING", "SUCCEEDED", "FAILED", "UNKNOWN", "REVERSED"];
        if (type && !allowedTypes.includes(type)) return json({ error: "invalid_agency_transaction_type" }, 400);
        if (status && !allowedStatuses.includes(status)) return json({ error: "invalid_agency_transaction_status" }, 400);

        // Managers can review the company's transactions. Other staff can only
        // see transactions they created; request/response metadata is never returned.
        const clauses = ["company_id = ?1"];
        const values: unknown[] = [staff.company_id];
        if (!canManage(staff)) {
          values.push(staff.id);
          clauses.push(`actor_id = ?${values.length}`);
        }
        if (type) {
          values.push(type);
          clauses.push(`transaction_type = ?${values.length}`);
        }
        if (status) {
          values.push(status);
          clauses.push(`provider_status = ?${values.length}`);
        }
        const result = await env.DB.prepare(
          `SELECT id, reference, transaction_type, provider, provider_reference, provider_status, amount, commission, currency, customer_reference, actor_id, created_at, updated_at
             FROM omni_agency_transactions
            WHERE ${clauses.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT 100`
        ).bind(...values).all();
        return json({ data: result.results, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/agency-transactions") {
        return json({ error: "provider_adapter_required", detail: "No provider call was made and no agency transaction was recorded." }, 501);
      }

      if (request.method === "GET" && url.pathname === "/api/ledger") {
        if (!canManage(staff)) return json({ error: "forbidden" }, 403);
        const type = url.searchParams.get("type");
        if (type && type !== "RETAIL" && type !== "FINTECH_AGENCY") return json({ error: "invalid_ledger_type" }, 400);
        const query = type
          ? env.DB.prepare("SELECT id,ledger_type,account_code,currency,debit,credit,source_type,source_id,description,effective_at,created_at FROM omni_ledger_entries WHERE ledger_type=?1 AND company_id=?2 ORDER BY effective_at DESC LIMIT 500").bind(type, staff.company_id)
          : env.DB.prepare("SELECT id,ledger_type,account_code,currency,debit,credit,source_type,source_id,description,effective_at,created_at FROM omni_ledger_entries WHERE company_id=?1 ORDER BY effective_at DESC LIMIT 500").bind(staff.company_id);
        const result = await query.all();
        return json({ data: result.results, requestId: rid });
      }

      return json({ error: "not_found", requestId: rid }, 404);
    } catch {
      return json({ error: "internal_error", requestId: rid }, 500);
    }
  }
};

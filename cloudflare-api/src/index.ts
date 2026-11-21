import { QuicktellerBusinessSandboxClient, QuicktellerBusinessError } from "./providers/quickteller-business-sandbox";
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
  OTYAPOINT_BOOTSTRAP_SECRET?: string | { get(): Promise<string> };
  OTYAPOINT_INVITE_SERVICE_TOKEN?: string | { get(): Promise<string> };
  OTYAPOINT_COMPANY_ID?: string;
  QUICKTELLER_CLIENT_ID?: string | { get(): Promise<string> };
  QUICKTELLER_CLIENT_SECRET?: string | { get(): Promise<string> };
  QUICKTELLER_MERCHANT_CODE?: string | { get(): Promise<string> };
  QUICKTELLER_PAY_ITEM_ID?: string | { get(): Promise<string> };
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
async function resolveSecretStoreValue(value: string | { get(): Promise<string> } | undefined): Promise<string> {
  if (typeof value === "string") return value;
  if (!value || typeof value.get !== "function") return "";
  try {
    const secret = await value.get();
    return typeof secret === "string" ? secret : "";
  } catch {
    return "";
  }
}

const uuid = () => crypto.randomUUID();
const safeText = (value: unknown, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const int = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min ? Number(value) : null;
const isRole = (value: unknown): value is Role => typeof value === "string" && roles.includes(value as Role);
const isResponse = (value: Staff | Response): value is Response => value instanceof Response;
const isSovereign = (staff: Staff) => staff.role === "SOVEREIGN";
const assignableRoles: Role[] = ["ATTENDANT", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"];
const staffStatuses = ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"] as const;

type WorkArea =
  | "RETAIL" | "INVENTORY" | "MOBILE_MONEY" | "BILLS_AIRTIME"
  | "PURCHASING" | "FINANCE" | "WORKFORCE" | "COMPLIANCE" | "REPORTS";
type WorkAction = "READ" | "OPERATE" | "SUPERVISE" | "APPROVE";
type WorkContext = { branchId: string; workArea: WorkArea | "OWNER"; dutyRole: string };

function permitsWorkAction(context: WorkContext, action: WorkAction): boolean {
  if (context.workArea === "OWNER") return true;
  if (action === "READ") return true;
  if (action === "OPERATE") return ["OPERATOR", "SUPERVISOR", "APPROVER"].includes(context.dutyRole);
  if (action === "SUPERVISE") return ["SUPERVISOR", "APPROVER"].includes(context.dutyRole);
  return context.dutyRole === "APPROVER";
}

async function requireWorkContext(
  request: Request,
  env: Env,
  staff: Staff,
  areas: WorkArea[],
  action: WorkAction,
  explicitBranchId?: string | null,
): Promise<WorkContext | Response> {
  const url = new URL(request.url);
  const requestedBranchId = safeText(
    explicitBranchId || request.headers.get("x-otya-branch-id") || url.searchParams.get("branchId"),
    64,
  );

  if (isSovereign(staff)) {
    const branch = requestedBranchId
      ? await env.DB.prepare(
          "SELECT id FROM omni_branches WHERE id=?1 AND company_id=?2 AND status='ACTIVE' LIMIT 1"
        ).bind(requestedBranchId, staff.company_id).first<{ id: string }>()
      : await env.DB.prepare(
          "SELECT id FROM omni_branches WHERE company_id=?1 AND status='ACTIVE' AND is_primary=1 LIMIT 1"
        ).bind(staff.company_id).first<{ id: string }>();
    if (!branch) return json({ error: "active_branch_required" }, 409);
    return { branchId: branch.id, workArea: "OWNER", dutyRole: "APPROVER" };
  }

  if (areas.length === 0) return json({ error: "work_area_assignment_required" }, 403);
  const placeholders = areas.map((_, index) => "?" + (index + 3)).join(",");
  const rows = await env.DB.prepare(
    "SELECT a.branch_id,a.work_area,a.duty_role FROM omni_staff_work_assignments a JOIN omni_branches b ON b.id=a.branch_id AND b.company_id=a.company_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.status='ACTIVE' AND (a.expires_at IS NULL OR datetime(a.expires_at)>CURRENT_TIMESTAMP) AND b.status='ACTIVE' AND a.work_area IN (" + placeholders + ") ORDER BY a.branch_id,a.work_area"
  ).bind(staff.company_id, staff.id, ...areas).all<{ branch_id: string; work_area: WorkArea; duty_role: string }>();

  const scoped = rows.results.filter(row => !staff.branch_id || row.branch_id === staff.branch_id);
  const candidates = requestedBranchId
    ? scoped.filter(row => row.branch_id === requestedBranchId)
    : scoped;
  if (candidates.length === 0) {
    return json({
      error: requestedBranchId ? "branch_work_assignment_required" : "work_area_assignment_required",
      requiredWorkAreas: areas,
    }, 403);
  }

  const branches = [...new Set(candidates.map(row => row.branch_id))];
  if (!requestedBranchId && branches.length > 1) {
    return json({ error: "branch_selection_required", branchIds: branches }, 409);
  }

  const context = candidates.find(row => row.work_area === areas[0]) ?? candidates[0];
  const result: WorkContext = {
    branchId: context.branch_id,
    workArea: context.work_area,
    dutyRole: context.duty_role,
  };
  if (!permitsWorkAction(result, action)) {
    return json({ error: "work_area_duty_not_permitted", workArea: result.workArea, dutyRole: result.dutyRole }, 403);
  }
  return result;
}

const isWorkContextResponse = (value: WorkContext | Response): value is Response => value instanceof Response;

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
  if (!env.AUTH) return false;
  const inviteServiceToken = await resolveSecretStoreValue(env.OTYAPOINT_INVITE_SERVICE_TOKEN);
  if (inviteServiceToken.length < 32) return false;
  try {
    const response = await env.AUTH.fetch(new Request("https://auth/internal/notifications/omnipoint/staff-invitation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otya-service": "otyapoint",
        "x-otya-service-token": inviteServiceToken,
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
        const [tables, integrityObjects] = await Promise.all([
          env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'omni_%'").all<{ name: string }>(),
          env.DB.prepare("SELECT name FROM sqlite_master WHERE type IN ('index','trigger') AND name NOT LIKE 'sqlite_%'").all<{ name: string }>(),
        ]);
        // Readiness must reflect the complete API contract, not only the original
        // retail tables. In particular, the owner invitation guard, immutable
        // history triggers and cash/float book are required by current source.
        const expectedTables = [
          "omni_branches",
          "omni_staff_work_assignments",
          "omni_customers",
          "omni_suppliers",
          "omni_purchase_orders",
          "omni_purchase_order_lines",
          "omni_expenses",
          "omni_business_compliance_items",
          "omni_provider_connections",
          "omni_staff_attendance",
          "omni_leave_requests",
          "omni_branch_stock",
          "omni_branch_stock_movements",
          "omni_products", "omni_retail_sales", "omni_retail_sale_lines",
          "omni_stock_movements", "omni_agency_transactions", "omni_ledger_entries",
          "omni_reconciliation_sessions", "omni_audit_events", "omni_staff_memberships",
          "omni_staff_invitations", "omni_agency_accounts", "omni_agency_operations",
          "omni_agency_account_movements",
          "omni_branch_agency_accounts",
          "omni_branch_agency_operations",
          "omni_branch_agency_account_movements",
        ];
        const expectedObjects = [
          "idx_omni_sales_company_idempotency",
          "idx_omni_one_active_sovereign_per_company",
          "idx_omni_owner_bootstrap_once",
          "idx_omni_staff_company_status_role",
          "idx_omni_staff_invitation_pending_email",
          "idx_omni_staff_invitation_company_status",
          "idx_omni_staff_invitation_expiry",
          "omni_staff_invitation_membership_guard",
          "omni_ledger_entries_no_update",
          "omni_ledger_entries_no_delete",
          "omni_stock_movements_no_update",
          "omni_stock_movements_no_delete",
          "omni_audit_events_no_update",
          "omni_audit_events_no_delete",
          "idx_omni_agency_one_active_cash_drawer",
          "idx_omni_agency_one_active_provider_float",
          "omni_agency_account_movement_guard",
          "omni_agency_account_movement_apply",
          "omni_agency_operations_guard",
          "omni_agency_operations_no_update",
          "omni_agency_operations_no_delete",
          "omni_agency_account_movements_no_update",
          "omni_agency_account_movements_no_delete",
          "idx_omni_one_primary_branch_per_company",
          "idx_omni_branches_company_status",
          "idx_omni_sales_company_branch_created",
          "idx_omni_ledger_company_branch_type_date",
          "idx_omni_reconciliation_company_branch_date",
          "idx_omni_agency_company_branch_created",
          "omni_agency_transactions_branch_guard",
          "idx_omni_active_staff_work_assignment",
          "idx_omni_staff_work_assignment_lookup",
          "omni_staff_work_assignment_guard",
          "omni_staff_membership_branch_guard_insert",
          "omni_staff_membership_branch_guard_update",
          "omni_staff_work_assignment_update_guard",
          "omni_staff_work_assignment_reactivate_guard",
          "idx_omni_customers_company_name",
          "idx_omni_customers_company_phone",
          "idx_omni_suppliers_company_name",
          "idx_omni_purchase_orders_company_branch_status",
          "idx_omni_purchase_order_lines_order",
          "omni_purchase_order_line_company_guard",
          "omni_purchase_order_line_update_guard",
          "omni_purchase_order_branch_guard",
          "idx_omni_expenses_company_branch_status",
          "idx_omni_compliance_company_expiry",
          "omni_compliance_branch_guard",
          "idx_omni_provider_connections_company_status",
          "omni_provider_write_gate_insert",
          "omni_provider_write_gate_update",
          "idx_omni_attendance_company_date",
          "omni_attendance_scope_guard",
          "idx_omni_leave_company_staff_dates",
          "omni_leave_scope_guard",
          "idx_omni_branch_stock_company_branch",
          "idx_omni_branch_stock_movements_history",
          "omni_branch_stock_movement_guard",
          "omni_branch_stock_movement_apply",
          "omni_branch_stock_movements_no_update",
          "omni_branch_stock_movements_no_delete",
          "omni_sales_branch_guard",
          "omni_stock_movements_branch_guard",
          "omni_ledger_entries_branch_guard",
          "omni_reconciliation_branch_guard",
          "omni_expense_branch_guard",
          "idx_omni_branch_agency_one_cash",
          "idx_omni_branch_agency_one_float_provider",
          "idx_omni_branch_agency_accounts_lookup",
          "idx_omni_branch_agency_operations_history",
          "idx_omni_branch_agency_operations_actor",
          "idx_omni_branch_agency_movements_history",
          "idx_omni_branch_agency_movements_operation",
          "omni_branch_agency_account_guard",
          "omni_branch_agency_movement_guard",
          "omni_branch_agency_movement_apply",
          "omni_branch_agency_operation_guard",
          "omni_branch_agency_operations_no_update",
          "omni_branch_agency_operations_no_delete",
          "omni_branch_agency_movements_no_update",
          "omni_branch_agency_movements_no_delete",
        ];
        const tableNames = new Set(tables.results.map(row => row.name));
        const objectNames = new Set(integrityObjects.results.map(row => row.name));
        const ready = expectedTables.every(name => tableNames.has(name))
          && expectedObjects.every(name => objectNames.has(name));
        return json({ service: "opoint-local", status: ready ? "ok" : "schema_not_ready", schemaReady: ready, requestId: rid }, ready ? 200 : 503);
      } catch {
        return json({ service: "opoint-local", status: "database_unavailable", requestId: rid }, 503);
      }
    }
    if (request.method === "OPTIONS") return json({ error: "cors_not_enabled" }, 405);

    // One-time owner bootstrap. This path is disabled until a high-entropy
    // secret is provisioned directly in the isolated Cloudflare Worker.
    // Otya Auth still verifies the owner identity; the bootstrap secret never
    // substitutes for identity authentication.
    if (request.method === "POST" && url.pathname === "/api/bootstrap/sovereign") {
      const expectedSecret = await resolveSecretStoreValue(env.OTYAPOINT_BOOTSTRAP_SECRET);
      if (expectedSecret.length < 32) return json({ error: "owner_bootstrap_not_configured" }, 503);
      const providedSecret = request.headers.get("x-otyapoint-bootstrap-key") || "";
      if (!(await matchesBootstrapSecret(providedSecret, expectedSecret))) return json({ error: "forbidden" }, 403);

      const identity = await verifyOtyaIdentity(request.headers.get("authorization") || "", env);
      if (!identity) return json({ error: "identity_verification_failed" }, 401);
      const body = await parseBody(request);
      if (isBodyResponse(body)) return body;

      // Stable internal tenant key retained for schema compatibility; this is not the legal entity name or public brand.
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
      // Provider credential checks are restricted to the one-time-provisioned owner.
      // This route obtains a sandbox OAuth token only; it cannot create or move money.
      if (request.method === "POST" && url.pathname === "/api/integrations/quickteller/sandbox-auth") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);

        const [clientId, clientSecret, merchantCode, payItemId] = await Promise.all([
          resolveSecretStoreValue(env.QUICKTELLER_CLIENT_ID),
          resolveSecretStoreValue(env.QUICKTELLER_CLIENT_SECRET),
          resolveSecretStoreValue(env.QUICKTELLER_MERCHANT_CODE),
          resolveSecretStoreValue(env.QUICKTELLER_PAY_ITEM_ID),
        ]);
        const credentialConfiguration = {
          clientIdPresent: Boolean(clientId),
          clientSecretPresent: Boolean(clientSecret),
          merchantCodePresent: Boolean(merchantCode),
          payItemIdPresent: Boolean(payItemId),
        };
        const checkedAt = new Date().toISOString();

        if (!clientId || !clientSecret) {
          await audit(
            env, staff.id, "QUICKTELLER_SANDBOX_AUTH_CHECK", "INTEGRATION", "quickteller-business",
            "Owner requested a sandbox OAuth credential check",
            null,
            { environment: "sandbox", outcome: "not_configured", credentialConfiguration, checkedAt },
            rid,
          );
          return json({
            error: "quickteller_oauth_credentials_incomplete",
            data: { provider: "quickteller-business", environment: "sandbox", authentication: "not_checked", credentialConfiguration, checkedAt },
            requestId: rid,
          }, 503);
        }

        try {
          const client = new QuicktellerBusinessSandboxClient({ clientId, clientSecret });
          await client.getAccessToken();
          await audit(
            env, staff.id, "QUICKTELLER_SANDBOX_AUTH_CHECK", "INTEGRATION", "quickteller-business",
            "Owner completed a read-only sandbox OAuth credential check",
            null,
            { environment: "sandbox", outcome: "authenticated", credentialConfiguration, checkedAt },
            rid,
          );
          return json({
            data: {
              provider: "quickteller-business",
              environment: "sandbox",
              authentication: "successful",
              merchantConfiguration: credentialConfiguration.merchantCodePresent && credentialConfiguration.payItemIdPresent ? "complete" : "incomplete",
              credentialConfiguration,
              checkedAt,
            },
            requestId: rid,
          });
        } catch (error) {
          const providerError = error instanceof QuicktellerBusinessError ? error : null;
          const authenticationRejected = providerError?.httpStatus === 401 || providerError?.httpStatus === 403;
          const providerStatus = providerError?.httpStatus ?? null;
          await audit(
            env, staff.id, "QUICKTELLER_SANDBOX_AUTH_CHECK", "INTEGRATION", "quickteller-business",
            "Owner completed a read-only sandbox OAuth credential check",
            null,
            { environment: "sandbox", outcome: authenticationRejected ? "rejected" : "unavailable", providerStatus, credentialConfiguration, checkedAt },
            rid,
          );
          return json({
            error: authenticationRejected ? "quickteller_authentication_rejected" : "quickteller_authentication_unavailable",
            data: {
              provider: "quickteller-business",
              environment: "sandbox",
              authentication: "failed",
              providerStatus,
              credentialConfiguration,
              checkedAt,
            },
            requestId: rid,
          }, 502);
        }
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        const assignments = await env.DB.prepare(
          "SELECT a.id,a.branch_id,a.work_area,a.duty_role,a.status,a.expires_at,b.branch_code,b.name AS branch_name FROM omni_staff_work_assignments a JOIN omni_branches b ON b.id=a.branch_id AND b.company_id=a.company_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.status='ACTIVE' AND (a.expires_at IS NULL OR datetime(a.expires_at)>CURRENT_TIMESTAMP) ORDER BY b.name,a.work_area"
        ).bind(staff.company_id, staff.id).all();
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
            agentId: staff.agent_id,
            workAssignments: assignments.results
          },
          requestId: rid
        });
      }

      if (request.method === "GET" && url.pathname === "/api/branches") {
        const result = isSovereign(staff)
          ? await env.DB.prepare(
              "SELECT id,branch_code,name,district,town_council,location_label,public_phone,status,is_primary,created_at,updated_at FROM omni_branches WHERE company_id=?1 ORDER BY is_primary DESC,name LIMIT 250"
            ).bind(staff.company_id).all()
          : await env.DB.prepare(
              "SELECT b.id,b.branch_code,b.name,b.district,b.town_council,b.location_label,b.public_phone,b.status,b.is_primary,b.created_at,b.updated_at FROM omni_branches b WHERE b.company_id=?1 AND (b.id=?2 OR EXISTS (SELECT 1 FROM omni_staff_work_assignments a WHERE a.company_id=b.company_id AND a.staff_membership_id=?3 AND a.branch_id=b.id AND a.status='ACTIVE' AND (a.expires_at IS NULL OR datetime(a.expires_at)>CURRENT_TIMESTAMP))) ORDER BY b.is_primary DESC,b.name LIMIT 250"
            ).bind(staff.company_id, staff.branch_id || "", staff.id).all();
        return json({ data: result.results, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/branches") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const branchCode = safeText(body.branchCode, 20).toUpperCase();
        const name = safeText(body.name, 120);
        const district = safeText(body.district, 100) || null;
        const townCouncil = safeText(body.townCouncil, 100) || null;
        const locationLabel = safeText(body.locationLabel, 180) || null;
        const publicPhone = safeText(body.publicPhone, 32) || null;
        if (!/^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(branchCode) || !name) {
          return json({ error: "valid_branch_code_and_name_required" }, 400);
        }
        if (body.isPrimary !== undefined && typeof body.isPrimary !== "boolean") {
          return json({ error: "is_primary_must_be_boolean" }, 400);
        }
        const existingPrimary = await env.DB.prepare(
          "SELECT id FROM omni_branches WHERE company_id=?1 AND is_primary=1 AND status='ACTIVE' LIMIT 1"
        ).bind(staff.company_id).first<{ id: string }>();
        const isPrimary = body.isPrimary === true || (!existingPrimary && body.isPrimary !== false);
        if (isPrimary && existingPrimary) return json({ error: "primary_branch_already_exists" }, 409);
        const id = uuid();
        const data = { id, branchCode, name, district, townCouncil, locationLabel, publicPhone, status: "ACTIVE", isPrimary };
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_branches (id,company_id,branch_code,name,district,town_council,location_label,public_phone,status,is_primary) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ACTIVE',?9)"
            ).bind(id, staff.company_id, branchCode, name, district, townCouncil, locationLabel, publicPhone, isPrimary ? 1 : 0),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_BRANCH','BRANCH',?3,'Owner created a company branch',?4,?5,?6)"
            ).bind(uuid(), staff.id, id, JSON.stringify(data), rid, staff.company_id),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            return json({ error: "branch_code_or_primary_branch_conflict" }, 409);
          }
          throw error;
        }
        return json({ data, requestId: rid }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/staff/work-assignments") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const branchId = url.searchParams.get("branchId");
        const clauses = ["a.company_id=?1"];
        const values: unknown[] = [staff.company_id];
        if (branchId) {
          values.push(safeText(branchId, 64));
          clauses.push("a.branch_id=?" + values.length);
        }
        const result = await env.DB.prepare(
          "SELECT a.id,a.staff_membership_id,a.branch_id,a.work_area,a.duty_role,a.status,a.assigned_by,a.assigned_at,a.expires_at,s.display_name,s.email,s.agent_id,b.branch_code,b.name AS branch_name FROM omni_staff_work_assignments a JOIN omni_staff_memberships s ON s.id=a.staff_membership_id AND s.company_id=a.company_id JOIN omni_branches b ON b.id=a.branch_id AND b.company_id=a.company_id WHERE " + clauses.join(" AND ") + " ORDER BY b.name,s.display_name,a.work_area LIMIT 500"
        ).bind(...values).all();
        return json({ data: result.results, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/staff/work-assignments") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const staffMembershipId = safeText(body.staffMembershipId, 64);
        const branchId = safeText(body.branchId, 64);
        const workArea = safeText(body.workArea, 32).toUpperCase();
        const dutyRole = safeText(body.dutyRole, 24).toUpperCase();
        const allowedWorkAreas = ["RETAIL","INVENTORY","MOBILE_MONEY","BILLS_AIRTIME","PURCHASING","FINANCE","WORKFORCE","COMPLIANCE","REPORTS"];
        const allowedDutyRoles = ["OPERATOR","SUPERVISOR","APPROVER","VIEWER","AUDITOR"];
        const expiresAt = body.expiresAt == null || body.expiresAt === "" ? null : safeText(body.expiresAt, 40);
        if (!staffMembershipId || !branchId || !allowedWorkAreas.includes(workArea) || !allowedDutyRoles.includes(dutyRole)) {
          return json({ error: "valid_staff_branch_work_area_and_duty_role_required" }, 400);
        }
        if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || new Date(expiresAt).toISOString() !== expiresAt)) {
          return json({ error: "invalid_assignment_expiry" }, 400);
        }
        const id = uuid();
        const data = { id, staffMembershipId, branchId, workArea, dutyRole, status: "ACTIVE", expiresAt };
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_staff_work_assignments (id,company_id,staff_membership_id,branch_id,work_area,duty_role,status,assigned_by,expires_at) VALUES (?1,?2,?3,?4,?5,?6,'ACTIVE',?7,?8)"
            ).bind(id, staff.company_id, staffMembershipId, branchId, workArea, dutyRole, staff.id, expiresAt),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_WORK_ASSIGNMENT','STAFF_WORK_ASSIGNMENT',?3,'Owner assigned branch-scoped work duties',?4,?5,?6)"
            ).bind(uuid(), staff.id, id, JSON.stringify(data), rid, staff.company_id),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            return json({ error: "active_work_assignment_already_exists" }, 409);
          }
          if (error instanceof Error && /STAFF_MEMBERSHIP_OR_BRANCH_SCOPE_INVALID|BRANCH_NOT_AVAILABLE/.test(error.message)) {
            return json({ error: "staff_or_branch_not_available_for_assignment" }, 409);
          }
          throw error;
        }
        return json({ data, requestId: rid }, 201);
      }

      const workAssignmentAction = url.pathname.match(/^\/api\/staff\/work-assignments\/([^/]+)$/);
      if (request.method === "PATCH" && workAssignmentAction) {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const assignmentId = safeText(workAssignmentAction[1], 64);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const status = safeText(body.status, 16).toUpperCase();
        if (!["ACTIVE","SUSPENDED","REVOKED"].includes(status)) return json({ error: "invalid_work_assignment_status" }, 400);
        const current = await env.DB.prepare(
          "SELECT id,staff_membership_id,branch_id,work_area,duty_role,status,expires_at FROM omni_staff_work_assignments WHERE id=?1 AND company_id=?2 LIMIT 1"
        ).bind(assignmentId, staff.company_id).first<{ id: string; staff_membership_id: string; branch_id: string; work_area: string; duty_role: string; status: string; expires_at: string | null }>();
        if (!current) return json({ error: "work_assignment_not_found" }, 404);
        if (current.status === "REVOKED") return json({ error: "revoked_work_assignment_is_final" }, 409);
        try {
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE omni_staff_work_assignments SET status=?1 WHERE id=?2 AND company_id=?3"
            ).bind(status, assignmentId, staff.company_id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_WORK_ASSIGNMENT','STAFF_WORK_ASSIGNMENT',?3,'Owner changed work assignment status',?4,?5,?6,?7)"
            ).bind(uuid(), staff.id, assignmentId, JSON.stringify({ status: current.status }), JSON.stringify({ status }), rid, staff.company_id),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            return json({ error: "active_work_assignment_already_exists" }, 409);
          }
          if (error instanceof Error && /STAFF_MEMBERSHIP_OR_BRANCH_SCOPE_INVALID|BRANCH_NOT_AVAILABLE/.test(error.message)) {
            return json({ error: "staff_or_branch_not_available_for_assignment" }, 409);
          }
          throw error;
        }
        return json({ data: { id: assignmentId, status }, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/staff") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
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
        const context = await requireWorkContext(request, env, staff, ["RETAIL", "INVENTORY"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT p.id,p.sku,p.name,p.description,p.category,p.cost_price,p.selling_price,COALESCE(bs.quantity_on_hand,0) AS quantity_on_hand,COALESCE(bs.reorder_level,p.reorder_level) AS reorder_level,p.created_at,p.updated_at FROM omni_products p LEFT JOIN omni_branch_stock bs ON bs.product_id=p.id AND bs.company_id=p.company_id AND bs.branch_id=?1 WHERE p.is_active=1 AND p.company_id=?2 ORDER BY p.name LIMIT 500"
        ).bind(context.branchId, staff.company_id).all();
        return json({ data: result.results, count: result.results.length, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/branch-stock") {
        const context = await requireWorkContext(request, env, staff, ["RETAIL", "INVENTORY"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT bs.product_id,bs.quantity_on_hand,bs.reorder_level,bs.updated_at,p.sku,p.name,p.category,p.cost_price,p.selling_price FROM omni_branch_stock bs JOIN omni_products p ON p.id=bs.product_id AND p.company_id=bs.company_id WHERE bs.company_id=?1 AND bs.branch_id=?2 AND p.is_active=1 ORDER BY p.name LIMIT 500"
        ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/branch-stock/opening") {
        if (!isSovereign(staff)) return json({ error: "owner_approval_required" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const branchId = safeText(body.branchId, 64);
        const productId = safeText(body.productId, 64);
        const quantity = int(body.quantity, 1);
        const reason = safeText(body.reason, 500);
        const idempotencyKey = safeText(body.idempotencyKey, 128);
        if (!branchId || !productId || quantity === null || !reason ||
            !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
          return json({ error: "valid_branch_product_quantity_reason_and_idempotency_key_required" }, 400);
        }
        const [branchRow, product, existing] = await Promise.all([
          env.DB.prepare("SELECT id FROM omni_branches WHERE id=?1 AND company_id=?2 AND status='ACTIVE' LIMIT 1").bind(branchId, staff.company_id).first<{ id: string }>(),
          env.DB.prepare("SELECT id,quantity_on_hand,reorder_level,is_active FROM omni_products WHERE id=?1 AND company_id=?2 LIMIT 1").bind(productId, staff.company_id).first<{ id: string; quantity_on_hand: number; reorder_level: number; is_active: number }>(),
          env.DB.prepare("SELECT id FROM omni_branch_stock WHERE company_id=?1 AND branch_id=?2 AND product_id=?3 LIMIT 1").bind(staff.company_id, branchId, productId).first<{ id: string }>()
        ]);
        if (!branchRow) return json({ error: "branch_not_available" }, 404);
        if (!product || product.is_active !== 1) return json({ error: "product_not_available" }, 404);
        if (existing) return json({ error: "branch_opening_stock_already_recorded" }, 409);
        const movementId = uuid();
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO omni_branch_stock_movements (id,company_id,branch_id,product_id,movement_type,quantity_delta,quantity_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'OPENING',?5,?5,?6,?7,?8)")
              .bind(movementId, staff.company_id, branchId, productId, quantity, idempotencyKey, staff.id, reason),
            env.DB.prepare("UPDATE omni_products SET quantity_on_hand=quantity_on_hand+?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3")
              .bind(quantity, productId, staff.company_id),
            env.DB.prepare("UPDATE omni_branch_stock SET reorder_level=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND branch_id=?3 AND product_id=?4")
              .bind(product.reorder_level, staff.company_id, branchId, productId),
            env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'OPEN_BRANCH_STOCK','BRANCH_STOCK',?3,?4,?5,?6,?7,?8)")
              .bind(uuid(), staff.id, productId, reason, JSON.stringify({ branchId, quantityOnHand: 0 }), JSON.stringify({ branchId, quantityOnHand: quantity }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("UNIQUE constraint failed") || error.message.includes("BRANCH_STOCK"))) {
            return json({ error: "branch_stock_opening_conflict" }, 409);
          }
          throw error;
        }
        return json({ data: { movementId, branchId, productId, quantityOnHand: quantity }, requestId: rid }, 201);
      }

      if (request.method === "POST" && url.pathname === "/api/branch-stock-adjustments") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const context = await requireWorkContext(request, env, staff, ["INVENTORY"], "SUPERVISE", safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        const productId = safeText(body.productId, 64);
        const delta = Number.isSafeInteger(body.quantityDelta) ? Number(body.quantityDelta) : null;
        const reason = safeText(body.reason, 500);
        const idempotencyKey = safeText(body.idempotencyKey, 128);
        if (!productId || delta === null || delta === 0 || !reason ||
            !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
          return json({ error: "valid_product_quantity_reason_and_idempotency_key_required" }, 400);
        }
        const [stock, product, duplicate] = await Promise.all([
          env.DB.prepare("SELECT quantity_on_hand FROM omni_branch_stock WHERE company_id=?1 AND branch_id=?2 AND product_id=?3 LIMIT 1").bind(staff.company_id, context.branchId, productId).first<{ quantity_on_hand: number }>(),
          env.DB.prepare("SELECT id,quantity_on_hand,is_active FROM omni_products WHERE id=?1 AND company_id=?2 LIMIT 1").bind(productId, staff.company_id).first<{ id: string; quantity_on_hand: number; is_active: number }>(),
          env.DB.prepare("SELECT id FROM omni_branch_stock_movements WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1").bind(staff.company_id, idempotencyKey).first<{ id: string }>()
        ]);
        if (!stock) return json({ error: "branch_stock_not_initialized" }, 409);
        if (!product || product.is_active !== 1) return json({ error: "product_not_available" }, 404);
        if (duplicate) return json({ error: "branch_stock_idempotency_conflict" }, 409);
        const nextQuantity = Number(stock.quantity_on_hand) + delta;
        const nextCompanyQuantity = Number(product.quantity_on_hand) + delta;
        if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0 ||
            !Number.isSafeInteger(nextCompanyQuantity) || nextCompanyQuantity < 0) {
          return json({ error: "insufficient_stock" }, 409);
        }
        const movementId = uuid();
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO omni_branch_stock_movements (id,company_id,branch_id,product_id,movement_type,quantity_delta,quantity_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'ADJUSTMENT',?5,?6,?7,?8,?9)")
              .bind(movementId, staff.company_id, context.branchId, productId, delta, nextQuantity, idempotencyKey, staff.id, reason),
            env.DB.prepare("UPDATE omni_products SET quantity_on_hand=quantity_on_hand+?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3 AND quantity_on_hand+?1>=0")
              .bind(delta, productId, staff.company_id),
            env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'ADJUST_BRANCH_STOCK','BRANCH_STOCK',?3,?4,?5,?6,?7,?8)")
              .bind(uuid(), staff.id, productId, reason, JSON.stringify({ branchId: context.branchId, quantityOnHand: stock.quantity_on_hand }), JSON.stringify({ branchId: context.branchId, quantityOnHand: nextQuantity }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("BRANCH_STOCK") || error.message.includes("INSUFFICIENT_STOCK") || error.message.includes("UNIQUE constraint failed"))) {
            return json({ error: "branch_stock_conflict_retry" }, 409);
          }
          throw error;
        }
        return json({ data: { movementId, branchId: context.branchId, productId, quantityOnHand: nextQuantity }, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/summary") {
        const context = await requireWorkContext(request, env, staff, ["FINANCE", "REPORTS"], "READ");
        if (isWorkContextResponse(context)) return context;
        const [products, sales, agency, retailLedger, agencyLedger] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN quantity_on_hand<=reorder_level THEN 1 ELSE 0 END),0) AS low_stock FROM omni_branch_stock WHERE company_id=?1 AND branch_id=?2").bind(staff.company_id, context.branchId).first<{ count: number; low_stock: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS total FROM omni_retail_sales WHERE status='COMPLETED' AND company_id=?1 AND branch_id=?2").bind(staff.company_id, context.branchId).first<{ count: number; total: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN provider_status='SUCCEEDED' THEN amount ELSE 0 END),0) AS succeeded_amount FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2").bind(staff.company_id, context.branchId).first<{ count: number; succeeded_amount: number }>(),
          env.DB.prepare("SELECT COALESCE(SUM(debit),0) AS debit,COALESCE(SUM(credit),0) AS credit FROM omni_ledger_entries WHERE ledger_type='RETAIL' AND company_id=?1 AND branch_id=?2").bind(staff.company_id, context.branchId).first<{ debit: number; credit: number }>(),
          env.DB.prepare("SELECT COALESCE(SUM(debit),0) AS debit,COALESCE(SUM(credit),0) AS credit FROM omni_ledger_entries WHERE ledger_type='FINTECH_AGENCY' AND company_id=?1 AND branch_id=?2").bind(staff.company_id, context.branchId).first<{ debit: number; credit: number }>()
        ]);
        return json({
          currency: "UGX",
          branchId: context.branchId,
          inventory: { activeProducts: products?.count || 0, lowStock: products?.low_stock || 0 },
          retail: { completedSales: sales?.count || 0, completedSalesTotal: sales?.total || 0, ledgerBalanced: (retailLedger?.debit || 0) === (retailLedger?.credit || 0) },
          agency: { transactions: agency?.count || 0, providerConfirmedAmount: agency?.succeeded_amount || 0, ledgerBalanced: (agencyLedger?.debit || 0) === (agencyLedger?.credit || 0) },
          demoData: false,
          requestId: rid
        });
      }

      if (request.method === "POST" && url.pathname === "/api/products") {
        const context = await requireWorkContext(request, env, staff, ["INVENTORY"], "SUPERVISE");
        if (isWorkContextResponse(context)) return context;
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
        return json({
          error: "branch_scoped_inventory_required",
          replacementEndpoint: "/api/branch-stock-adjustments",
          detail: "Company-wide stock adjustments are retired. Select a branch and use the branch stock ledger."
        }, 410);
      }

      if (request.method === "POST" && url.pathname === "/api/sales") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const context = await requireWorkContext(
          request, env, staff, ["RETAIL"], "OPERATE", safeText(body.branchId, 64)
        );
        if (isWorkContextResponse(context)) return context;
        const branchId = context.branchId;
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
          seen.add(productId);
          normalized.push({ productId, quantity });
        }

        const requestFingerprint = await saleRequestFingerprint(paymentMethod, normalized, branchId);
        const existing = await env.DB.prepare(
          "SELECT id,receipt_number,total,status,request_fingerprint FROM omni_retail_sales WHERE idempotency_key=?1 AND company_id=?2"
        ).bind(idempotencyKey, staff.company_id).first<{
          id: string; receipt_number: string; total: number; status: string; request_fingerprint: string | null
        }>();
        if (existing) {
          if (!existing.request_fingerprint || existing.request_fingerprint !== requestFingerprint) {
            return json({ error: "idempotency_key_payload_conflict" }, 409);
          }
          return json({
            data: { id: existing.id, receipt_number: existing.receipt_number, total: existing.total, status: existing.status, branchId },
            replayed: true,
            requestId: rid
          });
        }
        if (paymentMethod !== "CASH") return json({ error: "payment_method_not_enabled", allowed: ["CASH"] }, 422);

        const placeholders = normalized.map((_, i) => "?" + (i + 2)).join(",");
        const branchPlaceholders = normalized.map((_, i) => "?" + (i + 3)).join(",");
        const [productRows, branchStockRows] = await Promise.all([
          env.DB.prepare(
            "SELECT id,sku,name,cost_price,selling_price,quantity_on_hand,is_active FROM omni_products WHERE company_id=?1 AND id IN (" + placeholders + ")"
          ).bind(staff.company_id, ...normalized.map(item => item.productId)).all<{
            id: string; sku: string; name: string; cost_price: number; selling_price: number; quantity_on_hand: number; is_active: number
          }>(),
          env.DB.prepare(
            "SELECT product_id,quantity_on_hand FROM omni_branch_stock WHERE company_id=?1 AND branch_id=?2 AND product_id IN (" + branchPlaceholders + ")"
          ).bind(staff.company_id, branchId, ...normalized.map(item => item.productId)).all<{
            product_id: string; quantity_on_hand: number
          }>()
        ]);
        const productMap = new Map(productRows.results.map(product => [product.id, product]));
        const branchStockMap = new Map(branchStockRows.results.map(row => [row.product_id, row]));
        if (productMap.size !== normalized.length) return json({ error: "product_not_available" }, 409);
        if (branchStockMap.size !== normalized.length) return json({ error: "branch_stock_not_initialized" }, 409);

        let subtotal = 0;
        let costOfGoods = 0;
        const saleId = uuid();
        const receiptNumber = "OP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + uuid().slice(0, 8).toUpperCase();
        const saleLines: Array<{ id: string; productId: string; sku: string; name: string; quantity: number; price: number; cost: number; total: number }> = [];
        for (const item of normalized) {
          const product = productMap.get(item.productId)!;
          const branchStock = branchStockMap.get(item.productId)!;
          if (product.is_active !== 1) return json({ error: "product_not_available" }, 409);
          if (Number(branchStock.quantity_on_hand) < item.quantity) return json({ error: "insufficient_branch_stock" }, 409);
          const price = Number(product.selling_price);
          const cost = Number(product.cost_price);
          const lineTotal = price * item.quantity;
          const lineCost = cost * item.quantity;
          if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(lineCost)) return json({ error: "amount_overflow" }, 400);
          subtotal += lineTotal;
          costOfGoods += lineCost;
          saleLines.push({
            id: uuid(), productId: product.id, sku: product.sku, name: product.name,
            quantity: item.quantity, price, cost, total: lineTotal
          });
        }
        if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(costOfGoods) || subtotal <= 0) return json({ error: "invalid_sale_total" }, 400);

        const statements: D1Statement[] = [
          env.DB.prepare(
            "INSERT INTO omni_retail_sales (id,receipt_number,status,currency,subtotal,discount_total,tax_total,total,cost_of_goods,payment_method,idempotency_key,actor_id,company_id,branch_id,request_fingerprint) VALUES (?1,?2,'COMPLETED','UGX',?3,0,0,?3,?4,'CASH',?5,?6,?7,?8,?9)"
          ).bind(saleId, receiptNumber, subtotal, costOfGoods, idempotencyKey, staff.id, staff.company_id, branchId, requestFingerprint)
        ];
        for (const line of saleLines) {
          statements.push(env.DB.prepare(
            "INSERT INTO omni_retail_sale_lines (id,sale_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,unit_cost,line_total) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
          ).bind(line.id, saleId, line.productId, line.sku, line.name, line.quantity, line.price, line.cost, line.total));
        }
        for (const line of saleLines) {
          const current = branchStockMap.get(line.productId)!;
          statements.push(env.DB.prepare(
            "INSERT INTO omni_branch_stock_movements (id,company_id,branch_id,product_id,movement_type,quantity_delta,quantity_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'SALE',?5,?6,?7,?8,?9)"
          ).bind(
            uuid(), staff.company_id, branchId, line.productId, -line.quantity,
            Number(current.quantity_on_hand) - line.quantity,
            saleId + ":BRANCH:" + line.productId, staff.id, "Retail sale " + receiptNumber
          ));
        }
        statements.push(
          env.DB.prepare(
            "INSERT INTO omni_ledger_entries (id,ledger_type,account_code,currency,debit,credit,source_type,source_id,idempotency_key,description,company_id,branch_id) VALUES (?1,'RETAIL','CASH_ON_HAND','UGX',?2,0,'RETAIL_SALE',?3,?4,'Cash received for retail sale',?7,?8),(?5,'RETAIL','SALES_REVENUE','UGX',0,?2,'RETAIL_SALE',?3,?6,'Retail sales revenue',?7,?8)"
          ).bind(uuid(), subtotal, saleId, idempotencyKey + ":cash", uuid(), idempotencyKey + ":revenue", staff.company_id, branchId)
        );
        if (costOfGoods > 0) statements.push(
          env.DB.prepare(
            "INSERT INTO omni_ledger_entries (id,ledger_type,account_code,currency,debit,credit,source_type,source_id,idempotency_key,description,company_id,branch_id) VALUES (?1,'RETAIL','COST_OF_GOODS_SOLD','UGX',?2,0,'RETAIL_SALE',?3,?4,'Cost of goods sold',?7,?8),(?5,'RETAIL','INVENTORY','UGX',0,?2,'RETAIL_SALE',?3,?6,'Inventory relieved at cost',?7,?8)"
          ).bind(uuid(), costOfGoods, saleId, idempotencyKey + ":cogs", uuid(), idempotencyKey + ":inventory", staff.company_id, branchId)
        );
        statements.push(env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'POST_SALE','RETAIL_SALE',?3,'Branch-scoped cash sale posted',?4,?5,?6)"
        ).bind(uuid(), staff.id, saleId, JSON.stringify({ receiptNumber, subtotal, costOfGoods, currency: "UGX", branchId }), rid, staff.company_id));

        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (
            error.message.includes("INSUFFICIENT_STOCK")
            || error.message.includes("PRODUCT_NOT_AVAILABLE")
            || error.message.includes("BRANCH_STOCK")
          )) return json({ error: "branch_stock_conflict_or_product_unavailable" }, 409);
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            const replay = await env.DB.prepare(
              "SELECT id,receipt_number,total,status,request_fingerprint FROM omni_retail_sales WHERE idempotency_key=?1 AND company_id=?2"
            ).bind(idempotencyKey, staff.company_id).first<{
              id: string; receipt_number: string; total: number; status: string; request_fingerprint: string | null
            }>();
            if (replay) {
              if (!replay.request_fingerprint || replay.request_fingerprint !== requestFingerprint) {
                return json({ error: "idempotency_key_payload_conflict" }, 409);
              }
              return json({
                data: { id: replay.id, receipt_number: replay.receipt_number, total: replay.total, status: replay.status, branchId },
                replayed: true,
                requestId: rid
              });
            }
            return json({ error: "duplicate_conflict" }, 409);
          }
          throw error;
        }
        return json({
          data: { id: saleId, receiptNumber, subtotal, total: subtotal, currency: "UGX", status: "COMPLETED", branchId },
          requestId: rid
        }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/agency-readiness") {
        const context = await requireWorkContext(request, env, staff, ["MOBILE_MONEY", "BILLS_AIRTIME", "FINANCE"], "READ");
        if (isWorkContextResponse(context)) return context;

        // Read-only branch snapshot. It never contacts a provider, creates a
        // transaction or posts a ledger entry.
        const [totals, pending, unknown, providers] = await Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2"
          ).bind(staff.company_id, context.branchId).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2 AND provider_status IN ('DRAFT','PENDING')"
          ).bind(staff.company_id, context.branchId).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT COUNT(*) AS total FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2 AND provider_status='UNKNOWN'"
          ).bind(staff.company_id, context.branchId).first<{ total: number }>(),
          env.DB.prepare(
            "SELECT provider,COUNT(*) AS transactions FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2 GROUP BY provider ORDER BY provider"
          ).bind(staff.company_id, context.branchId).all<{ provider: string | null; transactions: number }>()
        ]);

        return json({
          service: "otyapoint-agency",
          currency: "UGX",
          branchId: context.branchId,
          mode: "LOCAL_RECORDS_ONLY",
          transactionCreation: "DISABLED_UNTIL_PROVIDER_ADAPTERS_AND_CONTROLS_ARE_VERIFIED",
          providers: [
            { id: "interswitch_marketplace_routing", status: "NOT_READY", adapter: "NOT_IMPLEMENTED" },
            { id: "quickteller_business", status: "NOT_CONFIGURED", adapter: "SANDBOX_STATUS_CLIENT_ONLY", paymentInitiation: "NOT_IMPLEMENTED" },
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

      if (request.method === "GET" && url.pathname === "/api/branch-agency/accounts") {
        const context = await requireWorkContext(request, env, staff, ["MOBILE_MONEY"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT id,branch_id,account_type,provider,account_code,display_name,currency,current_balance,status,created_at,updated_at FROM omni_branch_agency_accounts WHERE company_id=?1 AND branch_id=?2 ORDER BY account_type,provider"
        ).bind(staff.company_id, context.branchId).all();
        return json({
          data: result.results,
          branchId: context.branchId,
          balancesAreLocalRecords: true,
          requestId: rid
        });
      }

      if (request.method === "POST" && url.pathname === "/api/branch-agency/accounts") {
        if (!isSovereign(staff)) return json({ error: "owner_only_branch_agency_account_setup" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const branchId = safeText(body.branchId, 64);
        const accountType = safeText(body.accountType, 20).toUpperCase();
        const providerValue = safeText(body.provider, 24).toUpperCase();
        const provider = accountType === "CASH_DRAWER" ? null : providerValue;
        const openingBalance = int(body.openingBalance, 0);
        const displayName = safeText(body.displayName, 100);
        const idempotencyKey = safeText(request.headers.get("idempotency-key"), 128);
        if (!branchId || !["CASH_DRAWER", "PROVIDER_FLOAT"].includes(accountType) ||
            (accountType === "PROVIDER_FLOAT" && !["MTN_MOMO", "AIRTEL_MONEY"].includes(providerValue)) ||
            openingBalance === null || !displayName ||
            !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
          return json({ error: "valid_branch_account_type_provider_balance_name_and_idempotency_key_required" }, 400);
        }
        const branch = await env.DB.prepare(
          "SELECT id FROM omni_branches WHERE id=?1 AND company_id=?2 AND status='ACTIVE' LIMIT 1"
        ).bind(branchId, staff.company_id).first<{ id: string }>();
        if (!branch) return json({ error: "branch_not_available" }, 404);
        const accountCode = accountType === "CASH_DRAWER"
          ? "BRANCH_AGENCY_CASH"
          : provider === "MTN_MOMO" ? "BRANCH_FLOAT_MTN" : "BRANCH_FLOAT_AIRTEL";
        const existing = await env.DB.prepare(
          "SELECT id,current_balance,status FROM omni_branch_agency_accounts WHERE company_id=?1 AND branch_id=?2 AND account_type=?3 AND provider IS ?4 AND status='ACTIVE' LIMIT 1"
        ).bind(staff.company_id, branchId, accountType, provider).first<{ id: string; current_balance: number; status: string }>();
        if (existing) return json({ error: "active_branch_agency_account_exists", accountId: existing.id }, 409);

        const id = uuid();
        const statements: D1Statement[] = [
          env.DB.prepare(
            "INSERT INTO omni_branch_agency_accounts (id,company_id,branch_id,account_type,provider,account_code,display_name,current_balance,idempotency_key,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9)"
          ).bind(id, staff.company_id, branchId, accountType, provider, accountCode, displayName, idempotencyKey, staff.id)
        ];
        if (openingBalance > 0) {
          statements.push(env.DB.prepare(
            "INSERT INTO omni_branch_agency_account_movements (id,company_id,branch_id,account_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'OPENING_BALANCE','IN',?5,?5,?6,?7,?8)"
          ).bind(uuid(), staff.company_id, branchId, id, openingBalance, idempotencyKey + ":opening", staff.id, "Owner-recorded opening balance"));
        }
        statements.push(env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_BRANCH_AGENCY_ACCOUNT','BRANCH_AGENCY_ACCOUNT',?3,'Branch agency account created; opening amount is owner-recorded and not provider-confirmed',?4,?5,?6)"
        ).bind(uuid(), staff.id, id, JSON.stringify({ branchId, accountType, provider, openingBalance, currency: "UGX" }), rid, staff.company_id));
        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("UNIQUE constraint failed") || error.message.includes("BRANCH_AGENCY"))) {
            return json({ error: "branch_agency_account_conflict" }, 409);
          }
          throw error;
        }
        const account = await env.DB.prepare(
          "SELECT id,branch_id,account_type,provider,account_code,display_name,currency,current_balance,status,created_at,updated_at FROM omni_branch_agency_accounts WHERE id=?1 AND company_id=?2"
        ).bind(id, staff.company_id).first();
        return json({ data: account, balancesAreLocalRecords: true, requestId: rid }, 201);
      }

      if (request.method === "POST" && url.pathname === "/api/branch-agency/operations") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const context = await requireWorkContext(request, env, staff, ["MOBILE_MONEY"], "OPERATE", safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        const transactionType = safeText(body.transactionType, 16).toUpperCase();
        const provider = safeText(body.provider, 24).toUpperCase();
        const providerReference = safeText(body.providerReference, 120);
        const rawCustomerLast4 = body.customerReferenceLast4;
        const customerLast4 = typeof rawCustomerLast4 === "string" && rawCustomerLast4.trim()
          ? rawCustomerLast4.trim()
          : null;
        const amount = int(body.amount, 1);
        const idempotencyKey = safeText(request.headers.get("idempotency-key"), 128);
        if (!["CASH_IN", "CASH_OUT"].includes(transactionType) ||
            !["MTN_MOMO", "AIRTEL_MONEY"].includes(provider) ||
            providerReference.length < 3 || amount === null ||
            (customerLast4 !== null && !/^\d{4}$/.test(customerLast4)) ||
            !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
          return json({ error: "valid_transaction_provider_reference_amount_and_idempotency_key_required" }, 400);
        }

        const fingerprint = await sha256Hex(JSON.stringify({
          version: 1, branchId: context.branchId, transactionType, provider,
          providerReference, customerLast4, amount
        }));
        const duplicate = await env.DB.prepare(
          "SELECT id,reference,transaction_type,provider,provider_reference,amount,recording_status,request_fingerprint FROM omni_branch_agency_operations WHERE company_id=?1 AND branch_id=?2 AND idempotency_key=?3 LIMIT 1"
        ).bind(staff.company_id, context.branchId, idempotencyKey).first<{
          id: string; reference: string; transaction_type: string; provider: string; provider_reference: string;
          amount: number; recording_status: string; request_fingerprint: string
        }>();
        if (duplicate) {
          if (duplicate.request_fingerprint !== fingerprint) return json({ error: "agency_idempotency_payload_conflict" }, 409);
          return json({ data: duplicate, replayed: true, providerCall: "NOT_EXECUTED", requestId: rid });
        }

        const [cash, float] = await Promise.all([
          env.DB.prepare(
            "SELECT id,current_balance FROM omni_branch_agency_accounts WHERE company_id=?1 AND branch_id=?2 AND account_type='CASH_DRAWER' AND provider IS NULL AND status='ACTIVE' LIMIT 1"
          ).bind(staff.company_id, context.branchId).first<{ id: string; current_balance: number }>(),
          env.DB.prepare(
            "SELECT id,current_balance FROM omni_branch_agency_accounts WHERE company_id=?1 AND branch_id=?2 AND account_type='PROVIDER_FLOAT' AND provider=?3 AND status='ACTIVE' LIMIT 1"
          ).bind(staff.company_id, context.branchId, provider).first<{ id: string; current_balance: number }>()
        ]);
        if (!cash || !float) return json({ error: "branch_agency_accounts_not_configured" }, 409);
        const cashDelta = transactionType === "CASH_IN" ? amount : -amount;
        const floatDelta = -cashDelta;
        const cashAfter = Number(cash.current_balance) + cashDelta;
        const floatAfter = Number(float.current_balance) + floatDelta;
        if (!Number.isSafeInteger(cashAfter) || !Number.isSafeInteger(floatAfter) || cashAfter < 0 || floatAfter < 0) {
          return json({ error: "insufficient_branch_cash_or_provider_float" }, 409);
        }
        const operationId = uuid();
        const reference = "AG-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + operationId.slice(0,8).toUpperCase();
        const statements: D1Statement[] = [
          env.DB.prepare(
            "INSERT INTO omni_branch_agency_operations (id,company_id,branch_id,reference,transaction_type,provider,provider_reference,customer_reference_last4,amount,cash_account_id,float_account_id,request_fingerprint,idempotency_key,actor_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)"
          ).bind(operationId, staff.company_id, context.branchId, reference, transactionType, provider, providerReference, customerLast4, amount, cash.id, float.id, fingerprint, idempotencyKey, staff.id),
          env.DB.prepare(
            "INSERT INTO omni_branch_agency_account_movements (id,company_id,branch_id,account_id,operation_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
          ).bind(uuid(), staff.company_id, context.branchId, cash.id, operationId, transactionType, transactionType === "CASH_IN" ? "IN" : "OUT", amount, cashAfter, idempotencyKey + ":cash", staff.id, "Operator-recorded " + transactionType.replace("_"," ") + " cash movement"),
          env.DB.prepare(
            "INSERT INTO omni_branch_agency_account_movements (id,company_id,branch_id,account_id,operation_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
          ).bind(uuid(), staff.company_id, context.branchId, float.id, operationId, transactionType, transactionType === "CASH_IN" ? "OUT" : "IN", amount, floatAfter, idempotencyKey + ":float", staff.id, "Operator-recorded " + transactionType.replace("_"," ") + " provider float movement"),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RECORD_BRANCH_AGENCY_OPERATION','BRANCH_AGENCY_OPERATION',?3,'Operator-recorded only; provider call and provider confirmation were not performed',?4,?5,?6)"
          ).bind(uuid(), staff.id, operationId, JSON.stringify({ branchId: context.branchId, transactionType, provider, providerReference, amount, recordingStatus: "OPERATOR_RECORDED_UNVERIFIED" }), rid, staff.company_id)
        ];
        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("UNIQUE constraint failed") || error.message.includes("BRANCH_AGENCY") || error.message.includes("ACCOUNT_NOT_AVAILABLE"))) {
            return json({ error: "branch_agency_operation_conflict_retry" }, 409);
          }
          throw error;
        }
        return json({
          data: { id: operationId, reference, branchId: context.branchId, transactionType, provider, providerReference, amount, currency: "UGX", recordingStatus: "OPERATOR_RECORDED_UNVERIFIED" },
          providerCall: "NOT_EXECUTED",
          requestId: rid
        }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/agency-overview") {
        const context = await requireWorkContext(request, env, staff, ["MOBILE_MONEY"], "READ");
        if (isWorkContextResponse(context)) return context;
        const [totals, recent] = await Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) AS transaction_count,COALESCE(SUM(CASE WHEN provider_status='SUCCEEDED' THEN amount ELSE 0 END),0) AS confirmed_amount,COALESCE(SUM(CASE WHEN provider_status='SUCCEEDED' THEN commission ELSE 0 END),0) AS confirmed_commission,COALESCE(SUM(CASE WHEN provider_status IN ('PENDING','UNKNOWN') THEN 1 ELSE 0 END),0) AS needs_reconciliation,COALESCE(SUM(CASE WHEN provider_status='FAILED' THEN 1 ELSE 0 END),0) AS failed_count FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2 AND transaction_type IN ('CASH_IN','CASH_OUT','FLOAT_ADJUSTMENT','REVERSAL')"
          ).bind(staff.company_id, context.branchId).first<{
            transaction_count: number; confirmed_amount: number; confirmed_commission: number;
            needs_reconciliation: number; failed_count: number;
          }>(),
          env.DB.prepare(
            "SELECT id,reference,transaction_type,provider,provider_status,amount,commission,currency,created_at,updated_at FROM omni_agency_transactions WHERE company_id=?1 AND branch_id=?2 AND transaction_type IN ('CASH_IN','CASH_OUT','FLOAT_ADJUSTMENT','REVERSAL') ORDER BY created_at DESC LIMIT 10"
          ).bind(staff.company_id, context.branchId).all()
        ]);
        return json({
          source: "LOCAL_D1_RECORDS_ONLY",
          currency: "UGX",
          branchId: context.branchId,
          workArea: "MOBILE_MONEY",
          transactions: {
            count: totals?.transaction_count ?? 0,
            providerConfirmedAmount: totals?.confirmed_amount ?? 0,
            providerConfirmedCommission: totals?.confirmed_commission ?? 0,
            needsReconciliation: totals?.needs_reconciliation ?? 0,
            failed: totals?.failed_count ?? 0
          },
          recent: recent.results,
          requestId: rid
        });
      }

      if (request.method === "GET" && url.pathname === "/api/agency-transactions") {
        const type = url.searchParams.get("type");
        const status = url.searchParams.get("status");
        const mobileMoneyTypes = ["CASH_IN", "CASH_OUT", "FLOAT_ADJUSTMENT", "REVERSAL"];
        const billsTypes = ["AIRTIME", "BILL_PAYMENT"];
        const allowedTypes = [...mobileMoneyTypes, ...billsTypes];
        if (type && !allowedTypes.includes(type)) return json({ error: "invalid_agency_transaction_type" }, 400);
        const requiredAreas: WorkArea[] = type
          ? (mobileMoneyTypes.includes(type) ? ["MOBILE_MONEY"] : ["BILLS_AIRTIME"])
          : ["MOBILE_MONEY", "BILLS_AIRTIME"];
        const context = await requireWorkContext(request, env, staff, requiredAreas, "READ");
        if (isWorkContextResponse(context)) return context;
        const permittedTypes = context.workArea === "OWNER"
          ? (type ? (mobileMoneyTypes.includes(type) ? mobileMoneyTypes : billsTypes) : mobileMoneyTypes)
          : context.workArea === "MOBILE_MONEY" ? mobileMoneyTypes : billsTypes;
        if (type && !permittedTypes.includes(type)) return json({ error: "work_area_assignment_required" }, 403);
        const allowedStatuses = ["DRAFT", "PENDING", "SUCCEEDED", "FAILED", "UNKNOWN", "REVERSED"];
        if (status && !allowedStatuses.includes(status)) return json({ error: "invalid_agency_transaction_status" }, 400);

        const clauses = ["company_id=?1", "branch_id=?2", "transaction_type IN (" + permittedTypes.map((_, index) => "?" + (index + 3)).join(",") + ")"];
        const values: unknown[] = [staff.company_id, context.branchId, ...permittedTypes];
        if (type) {
          values.push(type);
          clauses.push("transaction_type=?" + values.length);
        }
        if (status) {
          values.push(status);
          clauses.push("provider_status=?" + values.length);
        }
        const result = await env.DB.prepare(
          "SELECT id,reference,transaction_type,provider,provider_reference,provider_status,amount,commission,currency,customer_reference,actor_id,created_at,updated_at FROM omni_agency_transactions WHERE " + clauses.join(" AND ") + " ORDER BY created_at DESC LIMIT 100"
        ).bind(...values).all();
        return json({ data: result.results, branchId: context.branchId, workArea: context.workArea, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/agency-transactions") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const type = safeText(body.transactionType, 24).toUpperCase();
        const mobileMoneyTypes = ["CASH_IN", "CASH_OUT", "FLOAT_ADJUSTMENT", "REVERSAL"];
        const billsTypes = ["AIRTIME", "BILL_PAYMENT"];
        if (!mobileMoneyTypes.includes(type) && !billsTypes.includes(type)) return json({ error: "invalid_agency_transaction_type" }, 400);
        const areas: WorkArea[] = mobileMoneyTypes.includes(type) ? ["MOBILE_MONEY"] : ["BILLS_AIRTIME"];
        const context = await requireWorkContext(request, env, staff, areas, "OPERATE", safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        return json({
          error: "provider_adapter_required",
          detail: "No provider call was made and no agency transaction was recorded.",
          branchId: context.branchId
        }, 501);
      }

      if (request.method === "GET" && url.pathname === "/api/ledger") {
        const context = await requireWorkContext(request, env, staff, ["FINANCE"], "READ");
        if (isWorkContextResponse(context)) return context;
        const type = url.searchParams.get("type");
        if (type && type !== "RETAIL" && type !== "FINTECH_AGENCY") return json({ error: "invalid_ledger_type" }, 400);
        const query = type
          ? env.DB.prepare("SELECT id,ledger_type,account_code,currency,debit,credit,source_type,source_id,description,effective_at,created_at,branch_id FROM omni_ledger_entries WHERE ledger_type=?1 AND company_id=?2 AND branch_id=?3 ORDER BY effective_at DESC LIMIT 500").bind(type, staff.company_id, context.branchId)
          : env.DB.prepare("SELECT id,ledger_type,account_code,currency,debit,credit,source_type,source_id,description,effective_at,created_at,branch_id FROM omni_ledger_entries WHERE company_id=?1 AND branch_id=?2 ORDER BY effective_at DESC LIMIT 500").bind(staff.company_id, context.branchId);
        const result = await query.all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }


      if (request.method === "GET" && url.pathname === "/api/customers") {
        const context = await requireWorkContext(request, env, staff, ["RETAIL", "MOBILE_MONEY", "BILLS_AIRTIME"], "READ");
        if (isWorkContextResponse(context)) return context;
        const search = safeText(url.searchParams.get("q"), 100);
        const result = search
          ? await env.DB.prepare(
              "SELECT id,customer_code,display_name,phone_number,email,status,created_at,updated_at FROM omni_customers WHERE company_id=?1 AND status='ACTIVE' AND (display_name LIKE ?2 OR phone_number LIKE ?2 OR customer_code LIKE ?2) ORDER BY display_name LIMIT 100"
            ).bind(staff.company_id, "%" + search + "%").all()
          : await env.DB.prepare(
              "SELECT id,customer_code,display_name,phone_number,email,status,created_at,updated_at FROM omni_customers WHERE company_id=?1 AND status='ACTIVE' ORDER BY display_name LIMIT 100"
            ).bind(staff.company_id).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/customers") {
        const context = await requireWorkContext(request, env, staff, ["RETAIL", "MOBILE_MONEY", "BILLS_AIRTIME"], "OPERATE");
        if (isWorkContextResponse(context)) return context;
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const displayName = safeText(body.displayName, 120);
        const phoneNumber = safeText(body.phoneNumber, 32) || null;
        const email = safeText(body.email, 254).toLowerCase() || null;
        if (displayName.length < 2 || (email && !validEmail(email))) {
          return json({ error: "valid_customer_name_and_email_required" }, 400);
        }
        const id = uuid();
        const customerCode = "CUS-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + id.slice(0, 8).toUpperCase();
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_customers (id,company_id,customer_code,display_name,phone_number,email,status,created_by) VALUES (?1,?2,?3,?4,?5,?6,'ACTIVE',?7)"
            ).bind(id, staff.company_id, customerCode, displayName, phoneNumber, email, staff.id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_CUSTOMER','CUSTOMER',?3,'Customer record created',?4,?5,?6)"
            ).bind(uuid(), staff.id, id, JSON.stringify({ customerCode, displayName, phoneNumber, email, branchId: context.branchId }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "customer_conflict" }, 409);
          throw error;
        }
        return json({ data: { id, customerCode, displayName, phoneNumber, email, status: "ACTIVE" }, branchId: context.branchId, requestId: rid }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/suppliers") {
        const context = await requireWorkContext(request, env, staff, ["PURCHASING"], "READ");
        if (isWorkContextResponse(context)) return context;
        const search = safeText(url.searchParams.get("q"), 100);
        const result = search
          ? await env.DB.prepare(
              "SELECT id,supplier_code,business_name,contact_name,phone_number,email,business_location,status,created_at,updated_at FROM omni_suppliers WHERE company_id=?1 AND status='ACTIVE' AND (business_name LIKE ?2 OR contact_name LIKE ?2 OR supplier_code LIKE ?2) ORDER BY business_name LIMIT 100"
            ).bind(staff.company_id, "%" + search + "%").all()
          : await env.DB.prepare(
              "SELECT id,supplier_code,business_name,contact_name,phone_number,email,business_location,status,created_at,updated_at FROM omni_suppliers WHERE company_id=?1 AND status='ACTIVE' ORDER BY business_name LIMIT 100"
            ).bind(staff.company_id).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/suppliers") {
        const context = await requireWorkContext(request, env, staff, ["PURCHASING"], "SUPERVISE");
        if (isWorkContextResponse(context)) return context;
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const businessName = safeText(body.businessName, 160);
        const contactName = safeText(body.contactName, 120) || null;
        const phoneNumber = safeText(body.phoneNumber, 32) || null;
        const email = safeText(body.email, 254).toLowerCase() || null;
        const businessLocation = safeText(body.businessLocation, 180) || null;
        if (businessName.length < 2 || (email && !validEmail(email))) {
          return json({ error: "valid_supplier_name_and_email_required" }, 400);
        }
        const id = uuid();
        const supplierCode = "SUP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + id.slice(0, 8).toUpperCase();
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_suppliers (id,company_id,supplier_code,business_name,contact_name,phone_number,email,business_location,status,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ACTIVE',?9)"
            ).bind(id, staff.company_id, supplierCode, businessName, contactName, phoneNumber, email, businessLocation, staff.id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_SUPPLIER','SUPPLIER',?3,'Supplier record created',?4,?5,?6)"
            ).bind(uuid(), staff.id, id, JSON.stringify({ supplierCode, businessName, contactName, phoneNumber, email, businessLocation, branchId: context.branchId }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "supplier_conflict" }, 409);
          throw error;
        }
        return json({ data: { id, supplierCode, businessName, contactName, phoneNumber, email, businessLocation, status: "ACTIVE" }, branchId: context.branchId, requestId: rid }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/purchase-orders") {
        const context = await requireWorkContext(request, env, staff, ["PURCHASING"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT po.id,po.order_number,po.status,po.currency,po.subtotal,po.total,po.notes,po.created_at,po.updated_at,s.id AS supplier_id,s.business_name AS supplier_name FROM omni_purchase_orders po JOIN omni_suppliers s ON s.id=po.supplier_id AND s.company_id=po.company_id WHERE po.company_id=?1 AND po.branch_id=?2 ORDER BY po.created_at DESC LIMIT 100"
        ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/purchase-orders") {
        const context = await requireWorkContext(request, env, staff, ["PURCHASING"], "SUPERVISE");
        if (isWorkContextResponse(context)) return context;
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const supplierId = safeText(body.supplierId, 64);
        const notes = safeText(body.notes, 500) || null;
        if (!supplierId || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) {
          return json({ error: "supplier_and_purchase_order_lines_required" }, 400);
        }
        const supplier = await env.DB.prepare(
          "SELECT id FROM omni_suppliers WHERE id=?1 AND company_id=?2 AND status='ACTIVE' LIMIT 1"
        ).bind(supplierId, staff.company_id).first<{ id: string }>();
        if (!supplier) return json({ error: "supplier_not_available" }, 404);

        const lines: Array<{ productId: string; quantity: number; unitCost: number; total: number }> = [];
        const uniqueProducts = new Set<string>();
        let subtotal = 0;
        for (const value of body.lines) {
          if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "invalid_purchase_order_line" }, 400);
          const line = value as Record<string, unknown>;
          const productId = safeText(line.productId, 64);
          const quantity = int(line.quantity, 1);
          const unitCost = int(line.unitCost, 0);
          if (!productId || quantity === null || unitCost === null || uniqueProducts.has(productId)) {
            return json({ error: "valid_unique_product_quantity_and_unit_cost_required" }, 400);
          }
          const total = quantity * unitCost;
          if (!Number.isSafeInteger(total)) return json({ error: "purchase_order_amount_overflow" }, 400);
          subtotal += total;
          if (!Number.isSafeInteger(subtotal)) return json({ error: "purchase_order_amount_overflow" }, 400);
          uniqueProducts.add(productId);
          lines.push({ productId, quantity, unitCost, total });
        }
        const productIds = lines.map(line => line.productId);
        const productRows = await env.DB.prepare(
          "SELECT id FROM omni_products WHERE company_id=?1 AND is_active=1 AND id IN (" + productIds.map((_, index) => "?" + (index + 2)).join(",") + ")"
        ).bind(staff.company_id, ...productIds).all<{ id: string }>();
        if (productRows.results.length !== lines.length) return json({ error: "purchase_order_product_not_available" }, 409);

        const id = uuid();
        const orderNumber = "PO-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + id.slice(0, 8).toUpperCase();
        const statements: D1Statement[] = [
          env.DB.prepare(
            "INSERT INTO omni_purchase_orders (id,company_id,branch_id,supplier_id,order_number,status,currency,subtotal,total,notes,created_by) VALUES (?1,?2,?3,?4,?5,'DRAFT','UGX',?6,?6,?7,?8)"
          ).bind(id, staff.company_id, context.branchId, supplierId, orderNumber, subtotal, notes, staff.id)
        ];
        for (const line of lines) {
          statements.push(env.DB.prepare(
            "INSERT INTO omni_purchase_order_lines (id,company_id,purchase_order_id,product_id,quantity_ordered,quantity_received,unit_cost,line_total) VALUES (?1,?2,?3,?4,?5,0,?6,?7)"
          ).bind(uuid(), staff.company_id, id, line.productId, line.quantity, line.unitCost, line.total));
        }
        statements.push(env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_PURCHASE_ORDER','PURCHASE_ORDER',?3,'Draft purchase order created',?4,?5,?6)"
        ).bind(uuid(), staff.id, id, JSON.stringify({ orderNumber, supplierId, branchId: context.branchId, subtotal, lines }), rid, staff.company_id));
        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("UNIQUE constraint failed") || error.message.includes("PURCHASE_ORDER"))) return json({ error: "purchase_order_conflict" }, 409);
          throw error;
        }
        return json({ data: { id, orderNumber, status: "DRAFT", currency: "UGX", subtotal, total: subtotal, branchId: context.branchId, lines }, requestId: rid }, 201);
      }

      const purchaseOrderAction = url.pathname.match(/^\/api\/purchase-orders\/([^/]+)\/(submit|approve|receive)$/);
      if (request.method === "POST" && purchaseOrderAction) {
        const orderId = safeText(purchaseOrderAction[1], 64);
        const action = purchaseOrderAction[2];
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const requiredAction: WorkAction = action === "submit" ? "SUPERVISE" : action === "approve" ? "APPROVE" : "OPERATE";
        const context = await requireWorkContext(request, env, staff, ["PURCHASING"], requiredAction, safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        const order = await env.DB.prepare(
          "SELECT id,order_number,status,branch_id,total,submitted_by,approved_by FROM omni_purchase_orders WHERE id=?1 AND company_id=?2 AND branch_id=?3 LIMIT 1"
        ).bind(orderId, staff.company_id, context.branchId).first<{
          id: string; order_number: string; status: string; branch_id: string; total: number;
          submitted_by: string | null; approved_by: string | null
        }>();
        if (!order) return json({ error: "purchase_order_not_found" }, 404);

        if (action === "submit") {
          if (order.status !== "DRAFT") return json({ error: "purchase_order_not_editable" }, 409);
          const now = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE omni_purchase_orders SET status='SUBMITTED',submitted_by=?1,submitted_at=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3 AND company_id=?4 AND status='DRAFT'"
            ).bind(staff.id, now, orderId, staff.company_id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'SUBMIT_PURCHASE_ORDER','PURCHASE_ORDER',?3,'Purchase order submitted for fulfilment',?4,?5,?6,?7)"
            ).bind(uuid(), staff.id, orderId, JSON.stringify({ status: order.status }), JSON.stringify({ status: "SUBMITTED" }), rid, staff.company_id)
          ]);
          return json({ data: { id: orderId, status: "SUBMITTED", approval: "PENDING" }, requestId: rid });
        }

        if (action === "approve") {
          if (order.status !== "SUBMITTED" || order.approved_by) return json({ error: "purchase_order_not_approvable" }, 409);
          if (order.submitted_by === staff.id) return json({ error: "maker_checker_required" }, 403);
          const approvedAt = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE omni_purchase_orders SET approved_by=?1,approved_at=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3 AND company_id=?4 AND branch_id=?5 AND status='SUBMITTED' AND approved_by IS NULL"
            ).bind(staff.id, approvedAt, orderId, staff.company_id, context.branchId),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'APPROVE_PURCHASE_ORDER','PURCHASE_ORDER',?3,'Purchase order approved by a separate authorized approver',?4,?5,?6,?7)"
            ).bind(uuid(), staff.id, orderId, JSON.stringify({ status: order.status, approvedBy: order.approved_by }), JSON.stringify({ status: order.status, approvedBy: staff.id, approvedAt }), rid, staff.company_id)
          ]);
          return json({ data: { id: orderId, status: "SUBMITTED", approval: "APPROVED", approvedBy: staff.id, approvedAt }, requestId: rid });
        }

        if (order.status !== "SUBMITTED" && order.status !== "PARTIALLY_RECEIVED") return json({ error: "purchase_order_not_receivable" }, 409);
        if (!order.approved_by) return json({ error: "purchase_order_approval_required" }, 403);
        if (!Array.isArray(body.receipts) || body.receipts.length < 1 || body.receipts.length > 100) {
          return json({ error: "purchase_receipt_lines_required" }, 400);
        }
        const storedLines = await env.DB.prepare(
          "SELECT l.id,l.product_id,l.quantity_ordered,l.quantity_received,l.unit_cost,p.quantity_on_hand,p.reorder_level FROM omni_purchase_order_lines l JOIN omni_products p ON p.id=l.product_id AND p.company_id=l.company_id WHERE l.company_id=?1 AND l.purchase_order_id=?2 ORDER BY l.product_id"
        ).bind(staff.company_id, orderId).all<{
          id: string; product_id: string; quantity_ordered: number; quantity_received: number;
          unit_cost: number; quantity_on_hand: number; reorder_level: number
        }>();
        const lineMap = new Map(storedLines.results.map(line => [line.product_id, line]));
        const receipts: Array<{ productId: string; quantity: number; quantityAfter: number; lineId: string; productQuantityAfter: number; unitCost: number }> = [];
        const seen = new Set<string>();
        for (const value of body.receipts) {
          if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "invalid_purchase_receipt_line" }, 400);
          const item = value as Record<string, unknown>;
          const productId = safeText(item.productId, 64);
          const quantity = int(item.quantity, 1);
          const line = lineMap.get(productId);
          if (!line || quantity === null || seen.has(productId) || line.quantity_received + quantity > line.quantity_ordered) {
            return json({ error: "purchase_receipt_quantity_not_allowed" }, 409);
          }
          const stock = await env.DB.prepare(
            "SELECT quantity_on_hand FROM omni_branch_stock WHERE company_id=?1 AND branch_id=?2 AND product_id=?3 LIMIT 1"
          ).bind(staff.company_id, context.branchId, productId).first<{ quantity_on_hand: number }>();
          const branchQuantity = Number(stock?.quantity_on_hand ?? 0);
          const quantityAfter = branchQuantity + quantity;
          const productQuantityAfter = Number(line.quantity_on_hand) + quantity;
          if (!Number.isSafeInteger(quantityAfter) || !Number.isSafeInteger(productQuantityAfter)) return json({ error: "purchase_receipt_amount_overflow" }, 400);
          receipts.push({ productId, quantity, quantityAfter, lineId: line.id, productQuantityAfter, unitCost: Number(line.unit_cost) });
          seen.add(productId);
        }
        const receiptKey = safeText(request.headers.get("idempotency-key"), 128);
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(receiptKey)) return json({ error: "idempotency_key_required" }, 400);
        const statements: D1Statement[] = [];
        for (const receipt of receipts) {
          statements.push(
            env.DB.prepare(
              "UPDATE omni_purchase_order_lines SET quantity_received=quantity_received+?1 WHERE company_id=?2 AND purchase_order_id=?3 AND id=?4"
            ).bind(receipt.quantity, staff.company_id, orderId, receipt.lineId),
            env.DB.prepare(
              "UPDATE omni_products SET quantity_on_hand=quantity_on_hand+?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3"
            ).bind(receipt.quantity, receipt.productId, staff.company_id),
            env.DB.prepare(
              "INSERT INTO omni_branch_stock_movements (id,company_id,branch_id,product_id,movement_type,quantity_delta,quantity_after,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'PURCHASE',?5,?6,?7,?8,?9)"
            ).bind(uuid(), staff.company_id, context.branchId, receipt.productId, receipt.quantity, receipt.quantityAfter, "PO:" + orderId + ":" + receiptKey + ":" + receipt.productId, staff.id, "Purchase receipt " + order.order_number),
            env.DB.prepare(
              "UPDATE omni_branch_stock SET reorder_level=?1 WHERE company_id=?2 AND branch_id=?3 AND product_id=?4"
            ).bind(storedLines.results.find(line => line.product_id === receipt.productId)?.reorder_level ?? 0, staff.company_id, context.branchId, receipt.productId)
          );
        }
        const fullyReceived = storedLines.results.every(line => {
          const receipt = receipts.find(item => item.productId === line.product_id);
          return line.quantity_received + (receipt?.quantity ?? 0) === line.quantity_ordered;
        });
        const nextStatus = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
        statements.push(
          env.DB.prepare(
            "UPDATE omni_purchase_orders SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3 AND branch_id=?4"
          ).bind(nextStatus, orderId, staff.company_id, context.branchId),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RECEIVE_PURCHASE_ORDER','PURCHASE_ORDER',?3,'Stock receipt recorded; no supplier payment was sent',?4,?5,?6)"
          ).bind(uuid(), staff.id, orderId, JSON.stringify({ status: nextStatus, branchId: context.branchId, receipts }), rid, staff.company_id)
        );
        try {
          await env.DB.batch(statements);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("BRANCH_STOCK") || error.message.includes("PURCHASE_QUANTITY") || error.message.includes("UNIQUE constraint failed"))) {
            return json({ error: "purchase_receipt_conflict_retry" }, 409);
          }
          throw error;
        }
        return json({ data: { id: orderId, status: nextStatus, branchId: context.branchId, receipts }, supplierPayment: "NOT_EXECUTED", requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/expenses") {
        const context = await requireWorkContext(request, env, staff, ["FINANCE"], "READ");
        if (isWorkContextResponse(context)) return context;
        const status = safeText(url.searchParams.get("status"), 20);
        const statuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID", "VOIDED"];
        if (status && !statuses.includes(status)) return json({ error: "invalid_expense_status" }, 400);
        const result = status
          ? await env.DB.prepare(
              "SELECT id,expense_reference,category,description,amount,currency,payment_method,status,created_by,submitted_at,approved_by,approved_at,created_at,updated_at FROM omni_expenses WHERE company_id=?1 AND branch_id=?2 AND status=?3 ORDER BY created_at DESC LIMIT 100"
            ).bind(staff.company_id, context.branchId, status).all()
          : await env.DB.prepare(
              "SELECT id,expense_reference,category,description,amount,currency,payment_method,status,created_by,submitted_at,approved_by,approved_at,created_at,updated_at FROM omni_expenses WHERE company_id=?1 AND branch_id=?2 ORDER BY created_at DESC LIMIT 100"
            ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/expenses") {
        const context = await requireWorkContext(request, env, staff, ["FINANCE"], "OPERATE");
        if (isWorkContextResponse(context)) return context;
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const category = safeText(body.category, 60);
        const description = safeText(body.description, 500);
        const amount = int(body.amount, 1);
        const paymentMethod = safeText(body.paymentMethod, 20).toUpperCase();
        if (!category || !description || amount === null || !["CASH", "BANK", "MOBILE_MONEY", "OTHER"].includes(paymentMethod)) {
          return json({ error: "valid_expense_category_description_amount_and_payment_method_required" }, 400);
        }
        const id = uuid();
        const reference = "EXP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + id.slice(0, 8).toUpperCase();
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO omni_expenses (id,company_id,branch_id,expense_reference,category,description,amount,currency,payment_method,status,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,'UGX',?8,'DRAFT',?9)"
          ).bind(id, staff.company_id, context.branchId, reference, category, description, amount, paymentMethod, staff.id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_EXPENSE','EXPENSE',?3,'Draft expense recorded; no payment was made',?4,?5,?6)"
          ).bind(uuid(), staff.id, id, JSON.stringify({ reference, category, description, amount, currency: "UGX", paymentMethod, branchId: context.branchId }), rid, staff.company_id)
        ]);
        return json({ data: { id, reference, category, description, amount, currency: "UGX", paymentMethod, status: "DRAFT", branchId: context.branchId }, payment: "NOT_EXECUTED", requestId: rid }, 201);
      }

      const expenseAction = url.pathname.match(/^\/api\/expenses\/([^/]+)\/(submit|approve|reject)$/);
      if (request.method === "POST" && expenseAction) {
        const id = safeText(expenseAction[1], 64);
        const action = expenseAction[2];
        const context = await requireWorkContext(request, env, staff, ["FINANCE"], action === "approve" || action === "reject" ? "APPROVE" : "OPERATE");
        if (isWorkContextResponse(context)) return context;
        const expense = await env.DB.prepare(
          "SELECT id,status,amount,expense_reference,branch_id FROM omni_expenses WHERE id=?1 AND company_id=?2 AND branch_id=?3 LIMIT 1"
        ).bind(id, staff.company_id, context.branchId).first<{ id: string; status: string; amount: number; expense_reference: string; branch_id: string }>();
        if (!expense) return json({ error: "expense_not_found" }, 404);
        const nextStatus = action === "submit" ? "SUBMITTED" : action === "approve" ? "APPROVED" : "REJECTED";
        const requiredStatus = action === "submit" ? "DRAFT" : "SUBMITTED";
        if (expense.status !== requiredStatus) return json({ error: "expense_transition_not_allowed" }, 409);
        const timestamp = new Date().toISOString();
        await env.DB.batch([
          action === "submit"
            ? env.DB.prepare(
                "UPDATE omni_expenses SET status='SUBMITTED',submitted_at=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3 AND branch_id=?4 AND status='DRAFT'"
              ).bind(timestamp, id, staff.company_id, context.branchId)
            : env.DB.prepare(
                "UPDATE omni_expenses SET status=?1,approved_by=?2,approved_at=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND company_id=?5 AND branch_id=?6 AND status='SUBMITTED'"
              ).bind(nextStatus, staff.id, timestamp, id, staff.company_id, context.branchId),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,?3,'EXPENSE',?4,'Expense workflow transition; no supplier or employee payment was sent',?5,?6,?7,?8)"
          ).bind(uuid(), staff.id, action.toUpperCase() + "_EXPENSE", id, JSON.stringify({ status: expense.status }), JSON.stringify({ status: nextStatus, payment: "NOT_EXECUTED" }), rid, staff.company_id)
        ]);
        return json({ data: { id, status: nextStatus, branchId: context.branchId }, payment: "NOT_EXECUTED", requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/attendance") {
        const context = await requireWorkContext(request, env, staff, ["WORKFORCE"], "READ");
        if (isWorkContextResponse(context)) return context;
        const workDate = safeText(url.searchParams.get("date"), 10);
        const result = workDate
          ? await env.DB.prepare(
              "SELECT a.id,a.staff_membership_id,a.work_date,a.shift_code,a.status,a.clock_in_at,a.clock_out_at,s.display_name FROM omni_staff_attendance a JOIN omni_staff_memberships s ON s.id=a.staff_membership_id AND s.company_id=a.company_id WHERE a.company_id=?1 AND a.branch_id=?2 AND a.work_date=?3 ORDER BY s.display_name LIMIT 250"
            ).bind(staff.company_id, context.branchId, workDate).all()
          : await env.DB.prepare(
              "SELECT a.id,a.staff_membership_id,a.work_date,a.shift_code,a.status,a.clock_in_at,a.clock_out_at,s.display_name FROM omni_staff_attendance a JOIN omni_staff_memberships s ON s.id=a.staff_membership_id AND s.company_id=a.company_id WHERE a.company_id=?1 AND a.branch_id=?2 ORDER BY a.work_date DESC,s.display_name LIMIT 250"
            ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/attendance") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const context = await requireWorkContext(request, env, staff, ["WORKFORCE"], "OPERATE", safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        const targetStaffId = safeText(body.staffMembershipId, 64);
        const workDate = safeText(body.workDate, 10);
        const shiftCode = safeText(body.shiftCode, 20) || "DAY";
        const status = safeText(body.status, 20).toUpperCase();
        const clockInAt = safeText(body.clockInAt, 40) || null;
        const clockOutAt = safeText(body.clockOutAt, 40) || null;
        if (!targetStaffId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate) ||
            !["PRESENT", "LATE", "ABSENT", "ON_LEAVE", "OFF_DAY"].includes(status)) {
          return json({ error: "valid_staff_work_date_and_attendance_status_required" }, 400);
        }
        if (!isSovereign(staff) && context.dutyRole === "OPERATOR" && targetStaffId !== staff.id) {
          return json({ error: "workforce_operator_can_only_record_own_attendance" }, 403);
        }
        const member = await env.DB.prepare(
          "SELECT id FROM omni_staff_memberships WHERE id=?1 AND company_id=?2 AND status='ACTIVE' AND (branch_id IS NULL OR branch_id=?3) LIMIT 1"
        ).bind(targetStaffId, staff.company_id, context.branchId).first<{ id: string }>();
        if (!member) return json({ error: "staff_member_not_available_for_branch" }, 404);
        const id = uuid();
        try {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO omni_staff_attendance (id,company_id,branch_id,staff_membership_id,work_date,shift_code,status,clock_in_at,clock_out_at,recorded_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
            ).bind(id, staff.company_id, context.branchId, targetStaffId, workDate, shiftCode, status, clockInAt, clockOutAt, staff.id),
            env.DB.prepare(
              "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RECORD_ATTENDANCE','STAFF_ATTENDANCE',?3,'Attendance record created',?4,?5,?6)"
            ).bind(uuid(), staff.id, id, JSON.stringify({ targetStaffId, workDate, shiftCode, status, branchId: context.branchId }), rid, staff.company_id)
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "attendance_already_recorded_for_shift" }, 409);
          throw error;
        }
        return json({ data: { id, staffMembershipId: targetStaffId, workDate, shiftCode, status, branchId: context.branchId }, requestId: rid }, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/leave-requests") {
        const context = await requireWorkContext(request, env, staff, ["WORKFORCE"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT l.id,l.staff_membership_id,l.leave_type,l.start_date,l.end_date,l.status,l.reviewed_by,l.reviewed_at,l.created_at,s.display_name FROM omni_leave_requests l JOIN omni_staff_memberships s ON s.id=l.staff_membership_id AND s.company_id=l.company_id WHERE l.company_id=?1 AND l.branch_id=?2 ORDER BY l.created_at DESC LIMIT 250"
        ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/leave-requests") {
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const context = await requireWorkContext(request, env, staff, ["WORKFORCE"], "OPERATE", safeText(body.branchId, 64));
        if (isWorkContextResponse(context)) return context;
        const targetStaffId = safeText(body.staffMembershipId, 64) || staff.id;
        const leaveType = safeText(body.leaveType, 20).toUpperCase();
        const startDate = safeText(body.startDate, 10);
        const endDate = safeText(body.endDate, 10);
        if (!isSovereign(staff) && context.dutyRole === "OPERATOR" && targetStaffId !== staff.id) {
          return json({ error: "workforce_operator_can_only_submit_own_leave" }, 403);
        }
        if (!["ANNUAL", "PERSONAL", "UNPAID", "OTHER"].includes(leaveType) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
          return json({ error: "valid_leave_type_and_date_range_required" }, 400);
        }
        const member = await env.DB.prepare(
          "SELECT id FROM omni_staff_memberships WHERE id=?1 AND company_id=?2 AND status='ACTIVE' AND (branch_id IS NULL OR branch_id=?3) LIMIT 1"
        ).bind(targetStaffId, staff.company_id, context.branchId).first<{ id: string }>();
        if (!member) return json({ error: "staff_member_not_available_for_branch" }, 404);
        const id = uuid();
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO omni_leave_requests (id,company_id,branch_id,staff_membership_id,leave_type,start_date,end_date,status) VALUES (?1,?2,?3,?4,?5,?6,?7,'SUBMITTED')"
          ).bind(id, staff.company_id, context.branchId, targetStaffId, leaveType, startDate, endDate),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'SUBMIT_LEAVE_REQUEST','LEAVE_REQUEST',?3,'Leave request submitted',?4,?5,?6)"
          ).bind(uuid(), staff.id, id, JSON.stringify({ targetStaffId, leaveType, startDate, endDate, branchId: context.branchId }), rid, staff.company_id)
        ]);
        return json({ data: { id, staffMembershipId: targetStaffId, leaveType, startDate, endDate, status: "SUBMITTED", branchId: context.branchId }, requestId: rid }, 201);
      }

      const leaveAction = url.pathname.match(/^\/api\/leave-requests\/([^/]+)\/(approve|reject)$/);
      if (request.method === "POST" && leaveAction) {
        const context = await requireWorkContext(request, env, staff, ["WORKFORCE"], "APPROVE", safeText(url.searchParams.get("branchId"), 64));
        if (isWorkContextResponse(context)) return context;
        const id = safeText(leaveAction[1], 64);
        const nextStatus = leaveAction[2] === "approve" ? "APPROVED" : "REJECTED";
        const requestRow = await env.DB.prepare(
          "SELECT id,status,staff_membership_id FROM omni_leave_requests WHERE id=?1 AND company_id=?2 AND branch_id=?3 LIMIT 1"
        ).bind(id, staff.company_id, context.branchId).first<{ id: string; status: string; staff_membership_id: string }>();
        if (!requestRow) return json({ error: "leave_request_not_found" }, 404);
        if (requestRow.status !== "SUBMITTED") return json({ error: "leave_transition_not_allowed" }, 409);
        const reviewedAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE omni_leave_requests SET status=?1,reviewed_by=?2,reviewed_at=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND company_id=?5 AND branch_id=?6 AND status='SUBMITTED'"
          ).bind(nextStatus, staff.id, reviewedAt, id, staff.company_id, context.branchId),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,?3,'LEAVE_REQUEST',?4,'Leave request reviewed',?5,?6,?7,?8)"
          ).bind(uuid(), staff.id, nextStatus + "_LEAVE_REQUEST", id, JSON.stringify({ status: "SUBMITTED" }), JSON.stringify({ status: nextStatus }), rid, staff.company_id)
        ]);
        return json({ data: { id, status: nextStatus, reviewedBy: staff.id }, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/compliance-items") {
        const context = await requireWorkContext(request, env, staff, ["COMPLIANCE"], "READ");
        if (isWorkContextResponse(context)) return context;
        const result = await env.DB.prepare(
          "SELECT id,branch_id,document_type,issuing_authority,display_label,reference_suffix,issue_date,expiry_date,status,reviewed_by,reviewed_at,review_note,created_by,created_at,updated_at FROM omni_business_compliance_items WHERE company_id=?1 AND (branch_id IS NULL OR branch_id=?2) ORDER BY expiry_date,status LIMIT 250"
        ).bind(staff.company_id, context.branchId).all();
        return json({ data: result.results, branchId: context.branchId, requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/compliance-items") {
        const context = await requireWorkContext(request, env, staff, ["COMPLIANCE"], "SUPERVISE");
        if (isWorkContextResponse(context)) return context;
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const documentType = safeText(body.documentType, 40).toUpperCase();
        const authority = safeText(body.issuingAuthority, 120) || null;
        const displayLabel = safeText(body.displayLabel, 180);
        const referenceSuffix = safeText(body.referenceSuffix, 12) || null;
        const issueDate = safeText(body.issueDate, 10) || null;
        const expiryDate = safeText(body.expiryDate, 10) || null;
        const allowedTypes = ["COMPANY_REGISTRATION", "TRADING_LICENCE", "TIN_RECORD", "PROVIDER_AGREEMENT", "BRANCH_PERMIT", "TAX_DOCUMENT", "OTHER"];
        if (!allowedTypes.includes(documentType) || displayLabel.length < 2 ||
            (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) ||
            (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) ||
            (issueDate && expiryDate && expiryDate < issueDate)) {
          return json({ error: "valid_compliance_document_metadata_required" }, 400);
        }
        const id = uuid();
        const companyWide = body.branchId === null;
        if (companyWide && !isSovereign(staff)) {
          return json({ error: "company_wide_compliance_record_owner_only" }, 403);
        }
        const branchId = companyWide ? null : context.branchId;
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO omni_business_compliance_items (id,company_id,branch_id,document_type,issuing_authority,display_label,reference_suffix,issue_date,expiry_date,status,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'PENDING_REVIEW',?10)"
          ).bind(id, staff.company_id, branchId, documentType, authority, displayLabel, referenceSuffix, issueDate, expiryDate, staff.id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_COMPLIANCE_ITEM','COMPLIANCE_ITEM',?3,'Compliance metadata added; no file was uploaded',?4,?5,?6)"
          ).bind(uuid(), staff.id, id, JSON.stringify({ branchId, documentType, authority, displayLabel, expiryDate, attachment: "NOT_UPLOADED" }), rid, staff.company_id)
        ]);
        return json({ data: { id, branchId, documentType, authority, displayLabel, referenceSuffix, issueDate, expiryDate, status: "PENDING_REVIEW", attachment: "NOT_UPLOADED" }, requestId: rid }, 201);
      }

      const complianceAction = url.pathname.match(/^\/api\/compliance-items\/([^/]+)\/(review|not-required)$/);
      if (request.method === "POST" && complianceAction) {
        const context = await requireWorkContext(request, env, staff, ["COMPLIANCE"], "APPROVE");
        if (isWorkContextResponse(context)) return context;
        const id = safeText(complianceAction[1], 64);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const status = complianceAction[2] === "not-required" ? "NOT_REQUIRED" : safeText(body.status, 20).toUpperCase();
        if (!["CURRENT", "REJECTED", "NOT_REQUIRED"].includes(status)) return json({ error: "invalid_compliance_review_status" }, 400);
        const note = safeText(body.note, 500) || null;
        const row = await env.DB.prepare(
          "SELECT id,status,branch_id FROM omni_business_compliance_items WHERE id=?1 AND company_id=?2 AND (branch_id IS NULL OR branch_id=?3) LIMIT 1"
        ).bind(id, staff.company_id, context.branchId).first<{ id: string; status: string; branch_id: string | null }>();
        if (!row) return json({ error: "compliance_item_not_found" }, 404);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE omni_business_compliance_items SET status=?1,reviewed_by=?2,reviewed_at=?3,review_note=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?5 AND company_id=?6"
          ).bind(status, staff.id, new Date().toISOString(), note, id, staff.company_id),
          env.DB.prepare(
            "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'REVIEW_COMPLIANCE_ITEM','COMPLIANCE_ITEM',?3,?4,?5,?6,?7,?8)"
          ).bind(uuid(), staff.id, id, note || "Compliance item reviewed", JSON.stringify({ status: row.status }), JSON.stringify({ status }), rid, staff.company_id)
        ]);
        return json({ data: { id, status, reviewedBy: staff.id }, requestId: rid });
      }

      if (request.method === "GET" && url.pathname === "/api/provider-connections") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const result = await env.DB.prepare(
          "SELECT id,provider,capability,environment,status,provider_contract_ref,approval_evidence_ref,approved_by,approved_at,production_write_enabled,credential_binding_name,last_verified_at,created_at,updated_at FROM omni_provider_connections WHERE company_id=?1 ORDER BY provider,capability,environment LIMIT 250"
        ).bind(staff.company_id).all<{
          id: string;
          provider: string;
          capability: string;
          environment: string;
          status: string;
          provider_contract_ref: string | null;
          approval_evidence_ref: string | null;
          approved_by: string | null;
          approved_at: string | null;
          production_write_enabled: number;
          credential_binding_name: string | null;
          last_verified_at: string | null;
          created_at: string;
          updated_at: string;
        }>();
        return json({ data: result.results, productionWriteEnabled: result.results.some(row => row.production_write_enabled === 1), requestId: rid });
      }

      if (request.method === "POST" && url.pathname === "/api/provider-connections") {
        if (!isSovereign(staff)) return json({ error: "forbidden" }, 403);
        const body = await parseBody(request);
        if (isBodyResponse(body)) return body;
        const provider = safeText(body.provider, 40).toUpperCase();
        const capability = safeText(body.capability, 40).toUpperCase();
        const environment = safeText(body.environment, 20).toUpperCase();
        const allowedProviders = ["MTN_MOMO", "AIRTEL_MONEY", "INTERSWITCH_MARKETPLACE", "QUICKTELLER_BUSINESS", "EFRIS", "AFRICASTALKING"];
        const allowedCapabilities = ["CASH_IN", "CASH_OUT", "AIRTIME", "DATA", "BILL_PAYMENT", "STATUS_ENQUIRY", "ACCOUNT_VALIDATION", "TAX_INVOICE", "SMS_OTP"];
        if (!allowedProviders.includes(provider) || !allowedCapabilities.includes(capability) || !["SANDBOX", "PRODUCTION"].includes(environment)) {
          return json({ error: "valid_provider_capability_and_environment_required" }, 400);
        }
        // These rows describe evidence and readiness only; this endpoint can never
        // enable live writes or accept credential values.
        const contractRef = safeText(body.providerContractRef, 120) || null;
        const approvalRef = safeText(body.approvalEvidenceRef, 180) || null;
        const credentialBindingName = safeText(body.credentialBindingName, 120) || null;
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO omni_provider_connections (id,company_id,provider,capability,environment,status,provider_contract_ref,approval_evidence_ref,credential_binding_name,production_write_enabled) VALUES (?1,?2,?3,?4,?5,'NOT_CONFIGURED',?6,?7,?8,0) ON CONFLICT(company_id,provider,capability,environment) DO UPDATE SET provider_contract_ref=excluded.provider_contract_ref,approval_evidence_ref=excluded.approval_evidence_ref,credential_binding_name=excluded.credential_binding_name,updated_at=CURRENT_TIMESTAMP"
        ).bind(id, staff.company_id, provider, capability, environment, contractRef, approvalRef, credentialBindingName).run();
        const row = await env.DB.prepare(
          "SELECT id,status,production_write_enabled FROM omni_provider_connections WHERE company_id=?1 AND provider=?2 AND capability=?3 AND environment=?4 LIMIT 1"
        ).bind(staff.company_id, provider, capability, environment).first<{ id: string; status: string; production_write_enabled: number }>();
        await env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RECORD_PROVIDER_EVIDENCE','PROVIDER_CONNECTION',?3,'Provider evidence updated; no credentials or provider request stored',?4,?5,?6)"
        ).bind(uuid(), staff.id, row?.id ?? id, JSON.stringify({ provider, capability, environment, credentialBindingName, productionWriteEnabled: false }), rid, staff.company_id).run();
        return json({ data: { id: row?.id ?? id, status: row?.status ?? "NOT_CONFIGURED", productionWriteEnabled: false }, requestId: rid }, 201);
      }

      return json({ error: "not_found", requestId: rid }, 404);
    } catch {
      return json({ error: "internal_error", requestId: rid }, 500);
    }
  }
};

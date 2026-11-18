import { cookies } from "next/headers";
import {
  callOpoint,
  fetchOtyaMe,
  isSameOriginRequest,
  jsonResponse,
  loadBrowserSession,
  readJsonLimited,
} from "@/lib/otya";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 160): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : "";
}

function idIsSafe(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,80}$/.test(value);
}

async function authenticatedContext() {
  const jar = await cookies();
  const session = await loadBrowserSession(jar);
  if (session.kind !== "authenticated") return { error: session.kind === "unavailable" ? "identity_service_unavailable" : "authentication_required", status: session.kind === "unavailable" ? 503 : 401 } as const;

  try {
    const me = await fetchOtyaMe(session.session.accessToken);
    return { session: session.session, memberships: me.memberships } as const;
  } catch {
    return { error: "otyapoint_membership_service_unavailable", status: 503 } as const;
  }
}

function requireCompany(memberships: Awaited<ReturnType<typeof fetchOtyaMe>>["memberships"], companyId: string) {
  return memberships.find(membership => membership.company_id === companyId && membership.status === "ACTIVE") ?? null;
}

async function forwardGet(request: Request): Promise<Response> {
  const context = await authenticatedContext();
  if ("error" in context) return jsonResponse({ error: context.error }, context.status);

  const url = new URL(request.url);
  const view = clean(url.searchParams.get("view"), 32);
  const companyId = clean(url.searchParams.get("companyId"), 80);
  const branchId = clean(url.searchParams.get("branchId"), 80);

  const routes: Record<string, string> = {
    staff: "/v1/staff",
    branches: "/v1/branches",
    invitations: "/v1/staff/invitations",
    assignments: "/v1/staff/work-assignments",
    "my-assignments": "/v1/me/work-assignments",
    "pending-memberships": "/v1/me/pending-memberships",
    "provider-operators": "/v1/me/provider-operator-assignments",
  };
  const path = routes[view];
  if (!path) return jsonResponse({ error: "unsupported_workforce_view" }, 400);

  const headers = new Headers();
  if (companyId) {
    if (!requireCompany(context.memberships, companyId)) {
      return jsonResponse({ error: "company_access_denied" }, 403);
    }
    headers.set("X-Company-ID", companyId);
  } else if (["staff", "branches", "invitations", "assignments"].includes(view)) {
    return jsonResponse({ error: "company_selection_required" }, 400);
  }

  const target = new URL(path, "https://opoint.internal");
  if (branchId) {
    if (!idIsSafe(branchId)) return jsonResponse({ error: "invalid_branch" }, 400);
    if (view === "staff" || view === "branches" || view === "assignments") {
      target.searchParams.set("branchId", branchId);
    }
  }

  try {
    const upstream = await callOpoint(target.pathname + target.search, context.session.accessToken, {
      method: "GET",
      headers,
    });
    const body = await upstream.json().catch(() => ({}));
    return jsonResponse(body, upstream.status);
  } catch {
    return jsonResponse({ error: "otyapoint_api_unavailable" }, 503);
  }
}

async function forwardPost(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "same_origin_required" }, 403);

  const context = await authenticatedContext();
  if ("error" in context) return jsonResponse({ error: context.error }, context.status);

  const parsed = await readJsonLimited(request, 8192);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, parsed.status);

  const body = parsed.value;
  const action = clean(body.action, 40);
  const companyId = clean(body.companyId, 80);
  const reason = clean(body.reason, 300);

  let path = "";
  let payload: Record<string, unknown> = {};
  let method = "POST";
  const headers = new Headers({ "Content-Type": "application/json" });

  if (action === "accept-invitation") {
    const token = clean(body.token, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) return jsonResponse({ error: "invalid_invitation_token" }, 400);
    if (!context.session.identity.emailVerified) return jsonResponse({ error: "verified_account_email_required" }, 403);
    path = "/v1/staff/invitations/accept";
    payload = { token };
  } else {
    if (!companyId || !requireCompany(context.memberships, companyId)) {
      return jsonResponse({ error: "company_access_denied" }, 403);
    }
    headers.set("X-Company-ID", companyId);

    switch (action) {
      case "create-invitation": {
        const email = clean(body.email, 254).toLowerCase();
        const displayName = clean(body.displayName, 120);
        const roleKey = clean(body.roleKey, 24).toUpperCase();
        const branchId = clean(body.branchId, 80);
        if (!email || !displayName || !roleKey) return jsonResponse({ error: "invitation_fields_required" }, 400);
        if (branchId && !idIsSafe(branchId)) return jsonResponse({ error: "invalid_branch" }, 400);
        path = "/v1/staff/invitations";
        payload = { email, displayName, roleKey, ...(branchId ? { branchId } : {}) };
        break;
      }
      case "revoke-invitation": {
        const invitationId = clean(body.invitationId, 80);
        if (!idIsSafe(invitationId) || reason.length < 4) return jsonResponse({ error: "invitation_id_and_reason_required" }, 400);
        path = "/v1/staff/invitations/" + encodeURIComponent(invitationId) + "/revoke";
        payload = { reason };
        break;
      }
      case "membership-status": {
        const membershipId = clean(body.membershipId, 80);
        const status = clean(body.status, 24).toUpperCase();
        if (!idIsSafe(membershipId) || !["ACTIVE", "SUSPENDED", "REVOKED"].includes(status) || reason.length < 4) {
          return jsonResponse({ error: "membership_id_status_and_reason_required" }, 400);
        }
        path = "/v1/staff/" + encodeURIComponent(membershipId) + "/status";
        payload = { status, reason };
        break;
      }
      case "create-assignment": {
        const staffMembershipId = clean(body.staffMembershipId, 80);
        const branchId = clean(body.branchId, 80);
        const workArea = clean(body.workArea, 24).toUpperCase();
        const dutyRole = clean(body.dutyRole, 24).toUpperCase();
        if (!idIsSafe(staffMembershipId) || !idIsSafe(branchId) || !["RETAIL", "MOBILE_MONEY"].includes(workArea)
          || !["OPERATOR", "SUPERVISOR", "APPROVER", "VIEWER"].includes(dutyRole) || reason.length < 4) {
          return jsonResponse({ error: "assignment_fields_invalid" }, 400);
        }
        path = "/v1/staff/work-assignments";
        headers.set("Idempotency-Key", crypto.randomUUID());
        payload = { staffMembershipId, branchId, workArea, dutyRole, reason };
        break;
      }
      case "assignment-status": {
        const assignmentId = clean(body.assignmentId, 80);
        const status = clean(body.status, 24).toUpperCase();
        if (!idIsSafe(assignmentId) || !["ACTIVE", "SUSPENDED", "REVOKED"].includes(status) || reason.length < 4) {
          return jsonResponse({ error: "assignment_id_status_and_reason_required" }, 400);
        }
        path = "/v1/staff/work-assignments/" + encodeURIComponent(assignmentId) + "/status";
        payload = { status, reason };
        break;
      }
      default:
        return jsonResponse({ error: "unsupported_workforce_action" }, 400);
    }
  }

  try {
    const scopedPath = companyId ? path + "?companyId=" + encodeURIComponent(companyId) : path;
    const upstream = await callOpoint(scopedPath, context.session.accessToken, {
      method,
      headers,
      body: JSON.stringify(payload),
    });
    const responseBody = await upstream.json().catch(() => ({}));
    return jsonResponse(responseBody, upstream.status);
  } catch {
    return jsonResponse({ error: "otyapoint_api_unavailable" }, 503);
  }
}

export async function GET(request: Request): Promise<Response> {
  return forwardGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return forwardPost(request);
}

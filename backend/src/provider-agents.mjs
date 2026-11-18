import { isPrivilegedCompanyRole } from "./work-assignments.mjs";

const PROVIDERS = Object.freeze(["MTN_MOMO", "AIRTEL_MONEY"]);
const DUTY_ROLES = Object.freeze(["OPERATOR", "SUPERVISOR", "APPROVER", "VIEWER"]);
const STATUSES = Object.freeze(["ACTIVE", "SUSPENDED", "REVOKED"]);
const FORBIDDEN_FIELD_NAMES = new Set([
  "pin", "otp", "password", "secret", "token", "accesstoken", "refreshtoken",
  "apikey", "privatekey", "clientsecret", "credentials", "authorization",
  "msisdn", "phone", "phonenumber", "phonee164", "contactnumber", "mobilenumber",
  "nationalid", "nationalidentificationnumber", "passport", "kyc", "kycdocument",
  "identitydocument", "rawkyc", "securitycode",
]);

const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
  : "";

function containsForbiddenField(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return FORBIDDEN_FIELD_NAMES.has(normalizedKey)
      || (item && typeof item === "object" && containsForbiddenField(item));
  });
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function response(body, status, requestId) {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readJson(request, maxBytes = 16_384) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { error: "request_too_large", status: 413 };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_json_object", status: 400 };
    if (containsForbiddenField(value)) return { error: "sensitive_credentials_or_identity_data_not_accepted", status: 400 };
    return { value };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

export function normalizeProviderAgentAccount(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_credentials_or_identity_data_not_accepted" };
  const providerCode = clean(body?.providerCode, 24).toUpperCase();
  const branchId = clean(body?.branchId, 80);
  const providerAgentReference = clean(body?.providerAgentReference, 120);
  const displayLabel = clean(body?.displayLabel, 100);
  const agentLineLast4 = body?.agentLineLast4 == null || body.agentLineLast4 === ""
    ? null
    : clean(body.agentLineLast4, 8);
  const reason = clean(body?.reason, 300);

  if (!PROVIDERS.includes(providerCode)) return { error: "invalid_provider_code" };
  if (!branchId) return { error: "branch_required" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(providerAgentReference)
      || /^\+?\d{9,15}$/.test(providerAgentReference)) {
    return { error: "invalid_provider_agent_reference_use_provider_agent_code_not_full_phone_number" };
  }
  if (displayLabel.length < 2) return { error: "display_label_required" };
  if (agentLineLast4 !== null && !/^\d{4}$/.test(agentLineLast4)) return { error: "agent_line_last4_must_be_four_digits" };
  if (reason.length < 4) return { error: "reason_required" };

  return { value: { providerCode, branchId, providerAgentReference, displayLabel, agentLineLast4, reason } };
}

export function normalizeProviderAccountStatus(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_credentials_or_identity_data_not_accepted" };
  const status = clean(body?.status, 24).toUpperCase();
  const providerApprovalReference = clean(body?.providerApprovalReference, 120);
  const reason = clean(body?.reason, 300);
  if (!STATUSES.includes(status)) return { error: "invalid_provider_account_status" };
  if (reason.length < 4) return { error: "reason_required" };
  if (status === "ACTIVE" && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$/.test(providerApprovalReference)) {
    return { error: "provider_approval_reference_required" };
  }
  return { value: { status, providerApprovalReference: providerApprovalReference || null, reason } };
}

export function normalizeProviderStaffAssignment(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_credentials_or_identity_data_not_accepted" };
  const staffMembershipId = clean(body?.staffMembershipId, 80);
  const dutyRole = clean(body?.dutyRole, 24).toUpperCase();
  const reason = clean(body?.reason, 300);
  if (!staffMembershipId) return { error: "staff_membership_required" };
  if (!DUTY_ROLES.includes(dutyRole)) return { error: "invalid_duty_role" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { staffMembershipId, dutyRole, reason } };
}

export function providerDutyAllowed(workAreaDutyRole, providerDutyRole) {
  const allowed = {
    VIEWER: ["VIEWER", "OPERATOR", "SUPERVISOR", "APPROVER"],
    OPERATOR: ["OPERATOR", "SUPERVISOR", "APPROVER"],
    SUPERVISOR: ["SUPERVISOR"],
    APPROVER: ["APPROVER"],
  };
  return Boolean(allowed[providerDutyRole]?.includes(workAreaDutyRole));
}

export async function handleProviderAgentRoutes(request, env, identity, membership, url, requestId) {
  if (!url.pathname.startsWith("/v1/provider-agent-accounts")) return null;
  if (!isPrivilegedCompanyRole(membership.role_key)) {
    return response({ error: "owner_or_admin_required" }, 403, requestId);
  }

  const companyId = membership.company_id;
  const basePath = "/v1/provider-agent-accounts";

  if (url.pathname === basePath && request.method === "GET") {
    const branchId = clean(url.searchParams.get("branchId"), 80) || null;
    const providerCode = clean(url.searchParams.get("providerCode"), 24).toUpperCase() || null;
    if (providerCode && !PROVIDERS.includes(providerCode)) return response({ error: "invalid_provider_code" }, 400, requestId);
    const rows = await env.DB.prepare(
      "SELECT id,branch_id,provider_code,provider_agent_reference,display_label,agent_line_last4,status,provider_approval_reference,provider_approved_at,created_by,created_at,updated_at FROM provider_agent_accounts WHERE company_id=?1 AND (?2 IS NULL OR branch_id=?2) AND (?3 IS NULL OR provider_code=?3) ORDER BY branch_id,provider_code,display_label LIMIT 200"
    ).bind(companyId, branchId, providerCode).all();
    return response({ data: rows.results || [] }, 200, requestId);
  }

  if (url.pathname === basePath && request.method === "POST") {
    const parsed = await readJson(request);
    if (parsed.error) return response({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderAgentAccount(parsed.value);
    if (normalized.error) return response({ error: normalized.error }, 400, requestId);
    const input = normalized.value;
    const idempotencyKey = clean(request.headers.get("idempotency-key"), 128);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return response({ error: "idempotency_key_required" }, 400, requestId);
    const fingerprint = await sha256(JSON.stringify(input));
    const prior = await env.DB.prepare(
      "SELECT id,request_fingerprint,status,branch_id,provider_code,provider_agent_reference FROM provider_agent_accounts WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1"
    ).bind(companyId, idempotencyKey).first();
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) return response({ error: "idempotency_key_reused_with_different_request" }, 409, requestId);
      return response({ data: prior, idempotentReplay: true }, 200, requestId);
    }
    const branch = await env.DB.prepare(
      "SELECT id FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
    ).bind(companyId, input.branchId).first();
    if (!branch) return response({ error: "active_branch_required" }, 409, requestId);

    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO provider_agent_accounts (id,company_id,branch_id,provider_code,provider_agent_reference,display_label,agent_line_last4,status,idempotency_key,request_fingerprint,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,'PENDING',?8,?9,?10)"
        ).bind(id, companyId, input.branchId, input.providerCode, input.providerAgentReference, input.displayLabel, input.agentLineLast4, idempotencyKey, fingerprint, identity.userId),
        env.DB.prepare(
          "INSERT INTO provider_agent_account_events (id,company_id,provider_agent_account_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?1,?2,?3,'CREATED',NULL,'PENDING',?4,?5)"
        ).bind(crypto.randomUUID(), companyId, id, identity.userId, input.reason),
        env.DB.prepare(
          "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,after_state_json) VALUES (?1,?2,?3,'PROVIDER_AGENT_ACCOUNT_CREATED','PROVIDER_AGENT_ACCOUNT',?4,?5,?6,?7)"
        ).bind(crypto.randomUUID(), companyId, identity.userId, id, input.reason, requestId, JSON.stringify({
          branchId: input.branchId, providerCode: input.providerCode,
          providerAgentReference: input.providerAgentReference, displayLabel: input.displayLabel,
          agentLineLast4: input.agentLineLast4, status: "PENDING",
        })),
      ]);
      return response({ data: { id, ...input, status: "PENDING", createdBy: identity.userId } }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) {
        return response({ error: "provider_agent_account_already_exists" }, 409, requestId);
      }
      console.error("[opoint] provider agent account creation failed", { type: error?.name || "Error" });
      return response({ error: "provider_agent_account_creation_failed" }, 500, requestId);
    }
  }

  const accountStatusMatch = url.pathname.match(/^\/v1\/provider-agent-accounts\/([A-Za-z0-9._:-]{1,80})\/status$/);
  const accountStaffMatch = url.pathname.match(/^\/v1\/provider-agent-accounts\/([A-Za-z0-9._:-]{1,80})\/staff-assignments$/);
  const staffStatusMatch = url.pathname.match(/^\/v1\/provider-agent-accounts\/([A-Za-z0-9._:-]{1,80})\/staff-assignments\/([A-Za-z0-9._:-]{1,80})\/status$/);

  if (accountStatusMatch && request.method === "POST") {
    const accountId = decodeURIComponent(accountStatusMatch[1]);
    const parsed = await readJson(request);
    if (parsed.error) return response({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderAccountStatus(parsed.value);
    if (normalized.error) return response({ error: normalized.error }, 400, requestId);
    const next = normalized.value;
    const current = await env.DB.prepare(
      "SELECT a.id,a.branch_id,a.provider_code,a.status,a.provider_approval_reference,a.provider_approved_at FROM provider_agent_accounts a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.id=?2 AND b.status='ACTIVE' LIMIT 1"
    ).bind(companyId, accountId).first();
    if (!current) return response({ error: "provider_agent_account_not_found" }, 404, requestId);
    if (current.status === next.status) return response({ data: current, idempotentReplay: true }, 200, requestId);
    if (current.status === "REVOKED") return response({ error: "revoked_provider_account_is_terminal" }, 409, requestId);
    const eventType = next.status === "ACTIVE"
      ? (current.status === "SUSPENDED" ? "REACTIVATED" : "ACTIVATED")
      : next.status;
    try {
      const changed = await env.DB.batch([
        env.DB.prepare(
          "UPDATE provider_agent_accounts SET status=?1,provider_approval_reference=CASE WHEN ?2 IS NULL THEN provider_approval_reference ELSE ?2 END,provider_approved_at=CASE WHEN ?1='ACTIVE' AND ?2 IS NOT NULL THEN CURRENT_TIMESTAMP WHEN ?1='ACTIVE' THEN COALESCE(provider_approved_at,CURRENT_TIMESTAMP) ELSE provider_approved_at END,updated_at=CURRENT_TIMESTAMP WHERE company_id=?3 AND id=?4 AND status=?5"
        ).bind(next.status, next.providerApprovalReference, companyId, accountId, current.status),
        env.DB.prepare(
          "INSERT INTO provider_agent_account_events (id,company_id,provider_agent_account_id,event_type,previous_status,new_status,actor_id,reason) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE changes()=1"
        ).bind(crypto.randomUUID(), companyId, accountId, eventType, current.status, next.status, identity.userId, next.reason),
        env.DB.prepare(
          "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) SELECT ?1,?2,?3,?4,'PROVIDER_AGENT_ACCOUNT',?5,?6,?7,?8,?9 WHERE changes()=1"
        ).bind(crypto.randomUUID(), companyId, identity.userId, "PROVIDER_AGENT_ACCOUNT_" + eventType, accountId, next.reason, requestId, JSON.stringify(current), JSON.stringify({ ...current, status: next.status })),
      ]);
      if (Number(changed?.[0]?.meta?.changes || 0) !== 1) return response({ error: "provider_account_changed_retry" }, 409, requestId);
      return response({ data: { ...current, status: next.status, providerApprovalReference: next.providerApprovalReference || current.provider_approval_reference } }, 200, requestId);
    } catch (error) {
      console.error("[opoint] provider agent status change failed", { type: error?.name || "Error" });
      return response({ error: "provider_agent_account_status_change_failed" }, 500, requestId);
    }
  }

  if (accountStaffMatch && request.method === "GET") {
    const accountId = decodeURIComponent(accountStaffMatch[1]);
    const account = await env.DB.prepare(
      "SELECT id FROM provider_agent_accounts WHERE company_id=?1 AND id=?2 LIMIT 1"
    ).bind(companyId, accountId).first();
    if (!account) return response({ error: "provider_agent_account_not_found" }, 404, requestId);
    const rows = await env.DB.prepare(
      "SELECT a.id,a.staff_membership_id,sm.display_name,sm.email,a.branch_id,a.duty_role,a.status,a.reason,a.created_by,a.created_at,a.updated_at,a.suspended_at,a.revoked_at FROM provider_agent_staff_assignments a JOIN staff_memberships sm ON sm.company_id=a.company_id AND sm.id=a.staff_membership_id WHERE a.company_id=?1 AND a.provider_agent_account_id=?2 ORDER BY sm.display_name LIMIT 300"
    ).bind(companyId, accountId).all();
    return response({ data: rows.results || [] }, 200, requestId);
  }

  if (accountStaffMatch && request.method === "POST") {
    const accountId = decodeURIComponent(accountStaffMatch[1]);
    const parsed = await readJson(request);
    if (parsed.error) return response({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderStaffAssignment(parsed.value);
    if (normalized.error) return response({ error: normalized.error }, 400, requestId);
    const input = normalized.value;
    const idempotencyKey = clean(request.headers.get("idempotency-key"), 128);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return response({ error: "idempotency_key_required" }, 400, requestId);
    const fingerprint = await sha256(JSON.stringify(input));
    const [account, staff] = await Promise.all([
      env.DB.prepare(
        "SELECT a.id,a.branch_id,a.status FROM provider_agent_accounts a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.id=?2 AND b.status='ACTIVE' LIMIT 1"
      ).bind(companyId, accountId).first(),
      env.DB.prepare(
        "SELECT id,role_key,status FROM staff_memberships WHERE company_id=?1 AND id=?2 LIMIT 1"
      ).bind(companyId, input.staffMembershipId).first(),
    ]);
    if (!account || account.status !== "ACTIVE") return response({ error: "active_provider_agent_account_required" }, 409, requestId);
    if (!staff || staff.status !== "ACTIVE") return response({ error: "active_staff_membership_required" }, 409, requestId);
    if (["OWNER", "ADMIN"].includes(staff.role_key)) return response({ error: "privileged_members_do_not_need_provider_assignments" }, 400, requestId);

    const workAssignment = await env.DB.prepare(
      "SELECT a.duty_role FROM staff_work_assignments a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.branch_id=?3 AND a.work_area='MOBILE_MONEY' AND a.status='ACTIVE' AND b.status='ACTIVE' LIMIT 1"
    ).bind(companyId, input.staffMembershipId, account.branch_id).first();
    if (!workAssignment) return response({ error: "mobile_money_work_assignment_required" }, 409, requestId);
    if (!providerDutyAllowed(workAssignment.duty_role, input.dutyRole)) {
      return response({ error: "provider_assignment_exceeds_work_area_duty" }, 403, requestId);
    }

    const prior = await env.DB.prepare(
      "SELECT id,request_fingerprint,status FROM provider_agent_staff_assignments WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1"
    ).bind(companyId, idempotencyKey).first();
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) return response({ error: "idempotency_key_reused_with_different_request" }, 409, requestId);
      return response({ data: prior, idempotentReplay: true }, 200, requestId);
    }

    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO provider_agent_staff_assignments (id,company_id,provider_agent_account_id,staff_membership_id,branch_id,duty_role,status,idempotency_key,request_fingerprint,reason,created_by) VALUES (?1,?2,?3,?4,?5,?6,'ACTIVE',?7,?8,?9,?10)"
        ).bind(id, companyId, accountId, input.staffMembershipId, account.branch_id, input.dutyRole, idempotencyKey, fingerprint, input.reason, identity.userId),
        env.DB.prepare(
          "INSERT INTO provider_agent_staff_assignment_events (id,company_id,assignment_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?1,?2,?3,'CREATED',NULL,'ACTIVE',?4,?5)"
        ).bind(crypto.randomUUID(), companyId, id, identity.userId, input.reason),
        env.DB.prepare(
          "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,after_state_json) VALUES (?1,?2,?3,'PROVIDER_AGENT_STAFF_ASSIGNED','PROVIDER_AGENT_STAFF_ASSIGNMENT',?4,?5,?6,?7)"
        ).bind(crypto.randomUUID(), companyId, identity.userId, id, input.reason, requestId, JSON.stringify({
          providerAgentAccountId: accountId, staffMembershipId: input.staffMembershipId,
          branchId: account.branch_id, dutyRole: input.dutyRole, status: "ACTIVE",
        })),
      ]);
      return response({ data: { id, providerAgentAccountId: accountId, staffMembershipId: input.staffMembershipId, branchId: account.branch_id, dutyRole: input.dutyRole, status: "ACTIVE" } }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return response({ error: "active_provider_staff_assignment_exists" }, 409, requestId);
      console.error("[opoint] provider agent staff assignment failed", { type: error?.name || "Error" });
      return response({ error: "provider_agent_staff_assignment_failed" }, 500, requestId);
    }
  }

  if (staffStatusMatch && request.method === "POST") {
    const accountId = decodeURIComponent(staffStatusMatch[1]);
    const assignmentId = decodeURIComponent(staffStatusMatch[2]);
    const parsed = await readJson(request);
    if (parsed.error) return response({ error: parsed.error }, parsed.status, requestId);
    if (containsForbiddenField(parsed.value)) return response({ error: "sensitive_credentials_or_identity_data_not_accepted" }, 400, requestId);
    const status = clean(parsed.value.status, 24).toUpperCase();
    const reason = clean(parsed.value.reason, 300);
    if (!["ACTIVE", "SUSPENDED", "REVOKED"].includes(status)) return response({ error: "invalid_provider_staff_assignment_status" }, 400, requestId);
    if (reason.length < 4) return response({ error: "reason_required" }, 400, requestId);
    const current = await env.DB.prepare(
      "SELECT id,status,staff_membership_id,branch_id,duty_role FROM provider_agent_staff_assignments WHERE company_id=?1 AND provider_agent_account_id=?2 AND id=?3 LIMIT 1"
    ).bind(companyId, accountId, assignmentId).first();
    if (!current) return response({ error: "provider_agent_staff_assignment_not_found" }, 404, requestId);
    if (current.status === status) return response({ data: current, idempotentReplay: true }, 200, requestId);
    if (current.status === "REVOKED") return response({ error: "revoked_staff_assignment_is_terminal" }, 409, requestId);
    if (status === "ACTIVE" && current.status !== "SUSPENDED") return response({ error: "only_suspended_assignments_can_be_resumed" }, 409, requestId);
    if (status === "SUSPENDED" && current.status !== "ACTIVE") return response({ error: "only_active_assignments_can_be_suspended" }, 409, requestId);
    if (status === "ACTIVE") {
      const [account, staff, workAssignment] = await Promise.all([
        env.DB.prepare(
          "SELECT a.id FROM provider_agent_accounts a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.id=?2 AND a.status='ACTIVE' AND b.status='ACTIVE' LIMIT 1"
        ).bind(companyId, accountId).first(),
        env.DB.prepare(
          "SELECT id FROM staff_memberships WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
        ).bind(companyId, current.staff_membership_id).first(),
        env.DB.prepare(
          "SELECT a.duty_role FROM staff_work_assignments a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.branch_id=?3 AND a.work_area='MOBILE_MONEY' AND a.status='ACTIVE' AND b.status='ACTIVE' LIMIT 1"
        ).bind(companyId, current.staff_membership_id, current.branch_id).first(),
      ]);
      if (!account || !staff) return response({ error: "active_provider_account_and_staff_required_to_resume" }, 409, requestId);
      if (!workAssignment || !providerDutyAllowed(workAssignment.duty_role, current.duty_role)) {
        return response({ error: "active_mobile_money_work_assignment_required_to_resume" }, 409, requestId);
      }
    }
    try {
      const eventType = status === "ACTIVE" ? "RESUMED" : status;
      const changed = await env.DB.batch([
        env.DB.prepare(
          "UPDATE provider_agent_staff_assignments SET status=?1,updated_at=CURRENT_TIMESTAMP,suspended_by=CASE WHEN ?1='SUSPENDED' THEN ?2 ELSE NULL END,suspended_at=CASE WHEN ?1='SUSPENDED' THEN CURRENT_TIMESTAMP ELSE NULL END,revoked_by=CASE WHEN ?1='REVOKED' THEN ?2 ELSE NULL END,revoked_at=CASE WHEN ?1='REVOKED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE company_id=?3 AND provider_agent_account_id=?4 AND id=?5 AND status=?6"
        ).bind(status, identity.userId, companyId, accountId, assignmentId, current.status),
        env.DB.prepare(
          "INSERT INTO provider_agent_staff_assignment_events (id,company_id,assignment_id,event_type,previous_status,new_status,actor_id,reason) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE changes()=1"
        ).bind(crypto.randomUUID(), companyId, assignmentId, eventType, current.status, status, identity.userId, reason),
        env.DB.prepare(
          "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) SELECT ?1,?2,?3,?4,'PROVIDER_AGENT_STAFF_ASSIGNMENT',?5,?6,?7,?8,?9 WHERE changes()=1"
        ).bind(crypto.randomUUID(), companyId, identity.userId, "PROVIDER_AGENT_STAFF_ASSIGNMENT_" + eventType, assignmentId, reason, requestId, JSON.stringify(current), JSON.stringify({ ...current, status })),
      ]);
      if (Number(changed?.[0]?.meta?.changes || 0) !== 1) return response({ error: "provider_staff_assignment_changed_retry" }, 409, requestId);
      return response({ data: { ...current, status } }, 200, requestId);
    } catch (error) {
      console.error("[opoint] provider agent staff status change failed", { type: error?.name || "Error" });
      return response({ error: "provider_agent_staff_assignment_status_change_failed" }, 500, requestId);
    }
  }

  return response({ error: "route_not_found" }, 404, requestId);
}

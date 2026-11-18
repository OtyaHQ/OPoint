import { isPrivilegedCompanyRole } from "./work-assignments.mjs";

const PROVIDERS = Object.freeze(["AIRTEL_MONEY", "MTN_MOMO"]);
const OUTLET_KINDS = Object.freeze(["AGENT_FLOAT", "MERCHANT_TILL", "PAYPOINT", "COMMISSION", "SETTLEMENT", "OTHER"]);
const RELATIONSHIP_STATES = Object.freeze(["APPLICATION", "DUE_DILIGENCE", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "CLOSED"]);
const OUTLET_STATES = Object.freeze(["ACTIVE", "SUSPENDED", "CLOSED"]);
const OPERATOR_STATES = Object.freeze(["APPROVED", "REJECTED", "SUSPENDED", "REVOKED"]);
const TRAINING_STATES = Object.freeze(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "EXPIRED"]);
const OPERATING_GRANT = "MOBILE_MONEY:OPERATE";
const FORBIDDEN_KEYS = new Set([
  "pin", "otp", "password", "secret", "token", "accesstoken", "refreshtoken",
  "apikey", "privatekey", "clientsecret", "credentials", "authorization",
  "msisdn", "phone", "phonenumber", "phonee164", "contactnumber", "mobilenumber",
  "nationalid", "nationalidentificationnumber", "passport", "kyc", "kycdocument",
  "identitydocument", "rawkyc", "securitycode", "puk",
]);

const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
  : "";

function containsForbiddenField(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return FORBIDDEN_KEYS.has(normalized)
      || (item && typeof item === "object" && containsForbiddenField(item));
  });
}

function validProviderReference(value, max = 120) {
  const ref = clean(value, max);
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(ref)
    && !/^\+?\d{9,15}$/.test(ref);
}

function reply(body, status, requestId) {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function readBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) return { error: "request_too_large", status: 413 };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid_json_object", status: 400 };
    if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted", status: 400 };
    return { value: body };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

export function normalizeProviderRelationship(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const providerCode = clean(body?.providerCode, 40).toUpperCase();
  const legalEntityName = clean(body?.legalEntityName, 180);
  const corporateAgentReference = clean(body?.corporateAgentReference, 120);
  const agreementReference = clean(body?.agreementReference, 120);
  const reason = clean(body?.reason, 300);
  if (!PROVIDERS.includes(providerCode)) return { error: "unsupported_provider" };
  if (legalEntityName.length < 3) return { error: "legal_entity_name_required" };
  if (corporateAgentReference && !validProviderReference(corporateAgentReference)) return { error: "invalid_corporate_agent_reference" };
  if (agreementReference && !validProviderReference(agreementReference)) return { error: "invalid_agreement_reference" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { providerCode, legalEntityName, corporateAgentReference: corporateAgentReference || null, agreementReference: agreementReference || null, reason } };
}

export function normalizeProviderRelationshipStatus(body, current = {}) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const onboardingStatus = clean(body?.onboardingStatus, 32).toUpperCase();
  const corporateAgentReference = body?.corporateAgentReference == null
    ? current.corporate_agent_reference
    : clean(body.corporateAgentReference, 120);
  const agreementReference = body?.agreementReference == null
    ? current.agreement_reference
    : clean(body.agreementReference, 120);
  const expiresAt = body?.expiresAt == null
    ? (current.expires_at || null)
    : body.expiresAt === "" ? null : clean(body.expiresAt, 40);
  const reason = clean(body?.reason, 300);
  if (!RELATIONSHIP_STATES.includes(onboardingStatus)) return { error: "invalid_onboarding_status" };
  if (reason.length < 4) return { error: "reason_required" };
  if (corporateAgentReference && !validProviderReference(corporateAgentReference)) return { error: "invalid_corporate_agent_reference" };
  if (agreementReference && !validProviderReference(agreementReference)) return { error: "invalid_agreement_reference" };
  if (onboardingStatus === "ACTIVE" && (!corporateAgentReference || !agreementReference)) {
    return { error: "active_provider_relationship_requires_corporate_and_agreement_references" };
  }
  if (expiresAt && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)))) return { error: "invalid_expiry_date" };
  if (onboardingStatus === "ACTIVE" && expiresAt && Date.parse(expiresAt) <= Date.now()) return { error: "provider_relationship_expiry_must_be_in_future" };
  return { value: { onboardingStatus, corporateAgentReference: corporateAgentReference || null, agreementReference: agreementReference || null, expiresAt, reason } };
}

export function normalizeOutletAccount(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const providerRelationshipId = clean(body?.providerRelationshipId, 80);
  const branchId = clean(body?.branchId, 80);
  const accountKind = clean(body?.accountKind, 24).toUpperCase();
  const outletAccountReference = clean(body?.outletAccountReference, 120);
  const displayName = clean(body?.displayName, 100);
  const cashAccountId = clean(body?.cashAccountId, 80) || null;
  const reason = clean(body?.reason, 300);
  if (!providerRelationshipId) return { error: "provider_relationship_required" };
  if (!branchId) return { error: "branch_required" };
  if (!OUTLET_KINDS.includes(accountKind)) return { error: "invalid_outlet_account_kind" };
  if (!validProviderReference(outletAccountReference)) return { error: "invalid_outlet_account_reference_use_provider_account_code_not_personal_phone" };
  if (displayName.length < 2) return { error: "display_name_required" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { providerRelationshipId, branchId, accountKind, outletAccountReference, displayName, cashAccountId, reason } };
}

export function normalizeOutletStatus(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const status = clean(body?.status, 24).toUpperCase();
  const reason = clean(body?.reason, 300);
  if (!OUTLET_STATES.includes(status)) return { error: "invalid_outlet_status" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { status, reason } };
}

export function normalizeProviderOperator(body) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const employeeProfileId = clean(body?.employeeProfileId, 80);
  const providerOperatorReference = clean(body?.providerOperatorReference, 120);
  const simAssetId = clean(body?.simAssetId, 80) || null;
  const reason = clean(body?.reason, 300);
  if (!employeeProfileId) return { error: "employee_profile_required" };
  if (!validProviderReference(providerOperatorReference)) return { error: "provider_operator_reference_required" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { employeeProfileId, providerOperatorReference, simAssetId, reason } };
}

export function normalizeProviderOperatorStatus(body, current = {}) {
  if (containsForbiddenField(body)) return { error: "sensitive_identity_or_credential_field_not_accepted" };
  const approvalStatus = clean(body?.approvalStatus, 24).toUpperCase();
  const trainingStatus = clean(body?.trainingStatus ?? current.training_status, 24).toUpperCase();
  const providerOperatorReference = body?.providerOperatorReference == null
    ? clean(current.provider_operator_reference, 120)
    : clean(body.providerOperatorReference, 120);
  const validUntil = body?.validUntil == null
    ? (current.valid_until || null)
    : body.validUntil === "" ? null : clean(body.validUntil, 40);
  const reason = clean(body?.reason, 300);
  if (!OPERATOR_STATES.includes(approvalStatus)) return { error: "invalid_operator_approval_status" };
  if (!TRAINING_STATES.includes(trainingStatus)) return { error: "invalid_training_status" };
  if (approvalStatus === "APPROVED" && (trainingStatus !== "COMPLETED" || !validProviderReference(providerOperatorReference))) {
    return { error: "operator_approval_requires_provider_reference_and_completed_training" };
  }
  if (validUntil && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(validUntil) || !Number.isFinite(Date.parse(validUntil)))) return { error: "invalid_operator_valid_until" };
  if (approvalStatus === "APPROVED" && validUntil && Date.parse(validUntil) <= Date.now()) return { error: "operator_valid_until_must_be_in_future" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { approvalStatus, trainingStatus, providerOperatorReference: providerOperatorReference || null, validUntil, reason } };
}

function auditStatement(env, { companyId, actorId, action, entityType, entityId, reason, requestId, beforeState, afterState }) {
  return env.DB.prepare(
    "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
  ).bind(
    crypto.randomUUID(), companyId, actorId, action, entityType, entityId, reason, requestId,
    beforeState == null ? null : JSON.stringify(beforeState),
    afterState == null ? null : JSON.stringify(afterState),
  );
}

async function requireActiveEmployeeAtBranch(env, companyId, employeeProfileId, branchId) {
  return env.DB.prepare(
    "SELECT ep.id,ep.staff_membership_id,ep.employment_status,sm.status AS membership_status FROM employee_profiles ep JOIN staff_memberships sm ON sm.company_id=ep.company_id AND sm.id=ep.staff_membership_id JOIN employee_assignments ea ON ea.company_id=ep.company_id AND ea.employee_profile_id=ep.id WHERE ep.company_id=?1 AND ep.id=?2 AND ep.employment_status='ACTIVE' AND sm.status='ACTIVE' AND ea.branch_id=?3 AND ea.status='ACTIVE' AND datetime(ea.starts_at)<=CURRENT_TIMESTAMP AND (ea.ends_at IS NULL OR datetime(ea.ends_at)>CURRENT_TIMESTAMP) LIMIT 1"
  ).bind(companyId, employeeProfileId, branchId).first();
}

async function requireMobileMoneyDuty(env, companyId, staffMembershipId, branchId) {
  const assignment = await env.DB.prepare(
    "SELECT a.id,a.duty_role FROM staff_work_assignments a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.branch_id=?3 AND a.work_area='MOBILE_MONEY' AND a.status='ACTIVE' AND b.status='ACTIVE' LIMIT 1"
  ).bind(companyId, staffMembershipId, branchId).first();
  if (!assignment || !["OPERATOR", "SUPERVISOR", "APPROVER"].includes(assignment.duty_role)) return null;
  return assignment;
}

async function validateAssignedSim(env, companyId, providerCode, employeeProfileId, branchId, simAssetId) {
  if (!simAssetId) return { ok: true };
  const network = providerCode === "AIRTEL_MONEY" ? "AIRTEL" : "MTN";
  const sim = await env.DB.prepare(
    "SELECT asset.id,sim.network_code FROM company_assets asset JOIN company_sim_details sim ON sim.company_id=asset.company_id AND sim.asset_id=asset.id JOIN asset_assignments aa ON aa.company_id=asset.company_id AND aa.asset_id=asset.id WHERE asset.company_id=?1 AND asset.id=?2 AND asset.asset_type='SIM_CARD' AND asset.lifecycle_status='ASSIGNED' AND sim.registration_status='COMPANY_REGISTERED' AND aa.employee_profile_id=?3 AND aa.branch_id=?4 AND aa.status='ISSUED' AND aa.returned_at IS NULL LIMIT 1"
  ).bind(companyId, simAssetId, employeeProfileId, branchId).first();
  if (!sim) return { ok: false, error: "active_company_sim_assignment_required" };
  if (network && sim.network_code !== network) return { ok: false, error: "company_sim_network_does_not_match_provider" };
  return { ok: true };
}

async function providerOutletContext(env, companyId, outletId) {
  return env.DB.prepare(
    "SELECT a.id,a.provider_relationship_id,a.branch_id,a.outlet_account_reference,a.account_kind,a.display_name,a.status,a.cash_account_id,r.provider_code,r.onboarding_status,r.expires_at FROM provider_outlet_accounts a JOIN provider_relationships r ON r.company_id=a.company_id AND r.id=a.provider_relationship_id WHERE a.company_id=?1 AND a.id=?2 LIMIT 1"
  ).bind(companyId, outletId).first();
}

export async function handleMyProviderOperatorAssignments(request, env, identity, requestId) {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/v1/me/provider-operator-assignments") return null;
  const rows = await env.DB.prepare(
    `SELECT op.id AS provider_operator_profile_id,op.provider_operator_reference,op.training_status,op.valid_until,pr.provider_code,poa.id AS provider_outlet_account_id,poa.outlet_account_reference,poa.display_name AS outlet_name,poa.branch_id,b.name AS branch_name,ea.employee_number FROM provider_operator_profiles op JOIN provider_relationships pr ON pr.company_id=op.company_id AND pr.id=op.provider_relationship_id JOIN provider_outlet_accounts poa ON poa.company_id=op.company_id AND poa.id=op.provider_outlet_account_id JOIN employee_profiles ep ON ep.company_id=op.company_id AND ep.id=op.employee_profile_id JOIN staff_memberships sm ON sm.company_id=ep.company_id AND sm.id=ep.staff_membership_id JOIN employee_assignments ea ON ea.company_id=ep.company_id AND ea.employee_profile_id=ep.id AND ea.branch_id=poa.branch_id JOIN branches b ON b.company_id=poa.company_id AND b.id=poa.branch_id JOIN staff_work_assignments wa ON wa.company_id=sm.company_id AND wa.staff_membership_id=sm.id AND wa.branch_id=poa.branch_id AND wa.work_area='MOBILE_MONEY' JOIN employee_permission_grants pg ON pg.company_id=op.company_id AND pg.employee_profile_id=ep.id AND pg.permission_key=?2 AND pg.scope_type='PROVIDER_ACCOUNT' AND pg.scope_id=poa.id WHERE sm.identity_subject=?1 AND sm.status='ACTIVE' AND ep.employment_status='ACTIVE' AND ea.status='ACTIVE' AND datetime(ea.starts_at)<=CURRENT_TIMESTAMP AND (ea.ends_at IS NULL OR datetime(ea.ends_at)>CURRENT_TIMESTAMP) AND wa.status='ACTIVE' AND wa.duty_role IN ('OPERATOR','SUPERVISOR','APPROVER') AND op.approval_status='APPROVED' AND op.training_status='COMPLETED' AND (op.valid_until IS NULL OR datetime(op.valid_until)>CURRENT_TIMESTAMP) AND pr.onboarding_status='ACTIVE' AND (pr.expires_at IS NULL OR datetime(pr.expires_at)>CURRENT_TIMESTAMP) AND poa.status='ACTIVE' AND b.status='ACTIVE' AND pg.status='ACTIVE' AND datetime(pg.starts_at)<=CURRENT_TIMESTAMP AND (pg.expires_at IS NULL OR datetime(pg.expires_at)>CURRENT_TIMESTAMP)
    AND (op.sim_asset_id IS NULL OR EXISTS (
      SELECT 1 FROM company_assets asset
      JOIN company_sim_details sim ON sim.company_id=asset.company_id AND sim.asset_id=asset.id
      JOIN asset_assignments aa ON aa.company_id=asset.company_id AND aa.asset_id=asset.id
      WHERE asset.company_id=op.company_id AND asset.id=op.sim_asset_id
        AND asset.asset_type='SIM_CARD' AND asset.lifecycle_status='ASSIGNED'
        AND sim.registration_status='COMPANY_REGISTERED'
        AND aa.employee_profile_id=op.employee_profile_id AND aa.branch_id=poa.branch_id
        AND aa.status='ISSUED' AND aa.returned_at IS NULL
        AND ((pr.provider_code='AIRTEL_MONEY' AND sim.network_code='AIRTEL')
          OR (pr.provider_code='MTN_MOMO' AND sim.network_code='MTN')
          OR pr.provider_code='INTERSWITCH_QUICKTELLER')
    )) ORDER BY pr.provider_code,b.name,poa.display_name LIMIT 100`
  ).bind(identity.userId, OPERATING_GRANT).all();
  return reply({ data: rows.results || [] }, 200, requestId);
}

export async function handleProviderOperatorRoutes(request, env, identity, membership, url, requestId) {
  const path = url.pathname;
  if (!path.startsWith("/v1/provider-relationships")
      && !path.startsWith("/v1/provider-outlet-accounts")
      && !path.startsWith("/v1/provider-operator-profiles")) return null;

  if (!isPrivilegedCompanyRole(membership.role_key)) return reply({ error: "owner_or_admin_required" }, 403, requestId);
  const companyId = membership.company_id;
  const actorId = identity.userId;

  if (path === "/v1/provider-relationships" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,provider_code,legal_entity_name,corporate_agent_reference,agreement_reference,onboarding_status,approved_at,expires_at,created_at,updated_at FROM provider_relationships WHERE company_id=?1 ORDER BY provider_code LIMIT 20"
    ).bind(companyId).all();
    return reply({ data: rows.results || [] }, 200, requestId);
  }

  if (path === "/v1/provider-relationships" && request.method === "POST") {
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderRelationship(parsed.value);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const input = normalized.value;
    const prior = await env.DB.prepare(
      "SELECT id,provider_code,legal_entity_name,corporate_agent_reference,agreement_reference,onboarding_status FROM provider_relationships WHERE company_id=?1 AND provider_code=?2 LIMIT 1"
    ).bind(companyId, input.providerCode).first();
    if (prior) {
      const same = prior.legal_entity_name === input.legalEntityName
        && (prior.corporate_agent_reference || null) === input.corporateAgentReference
        && (prior.agreement_reference || null) === input.agreementReference;
      return same
        ? reply({ data: prior, idempotentReplay: true }, 200, requestId)
        : reply({ error: "provider_relationship_already_exists_update_existing_record" }, 409, requestId);
    }
    const id = crypto.randomUUID();
    const after = { id, ...input, onboardingStatus: "APPLICATION" };
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO provider_relationships (id,company_id,provider_code,legal_entity_name,corporate_agent_reference,agreement_reference,onboarding_status) VALUES (?1,?2,?3,?4,?5,?6,'APPLICATION')"
        ).bind(id, companyId, input.providerCode, input.legalEntityName, input.corporateAgentReference, input.agreementReference),
        auditStatement(env, { companyId, actorId, action: "PROVIDER_RELATIONSHIP_CREATED", entityType: "PROVIDER_RELATIONSHIP", entityId: id, reason: input.reason, requestId, beforeState: null, afterState: after }),
      ]);
      return reply({ data: after }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return reply({ error: "provider_relationship_conflict" }, 409, requestId);
      console.error("[opoint] provider relationship create failed", { type: error?.name || "Error" });
      return reply({ error: "provider_relationship_create_failed" }, 500, requestId);
    }
  }

  const relationshipStatus = path.match(/^\/v1\/provider-relationships\/([A-Za-z0-9._:-]{1,80})\/status$/);
  if (relationshipStatus && request.method === "POST") {
    const id = decodeURIComponent(relationshipStatus[1]);
    const current = await env.DB.prepare(
      "SELECT id,provider_code,corporate_agent_reference,agreement_reference,onboarding_status,approved_at,expires_at FROM provider_relationships WHERE company_id=?1 AND id=?2 LIMIT 1"
    ).bind(companyId, id).first();
    if (!current) return reply({ error: "provider_relationship_not_found" }, 404, requestId);
    if (current.onboarding_status === "CLOSED") return reply({ error: "closed_provider_relationship_is_terminal" }, 409, requestId);
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderRelationshipStatus(parsed.value, current);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const next = normalized.value;
    if (current.onboarding_status === next.onboardingStatus
        && (current.corporate_agent_reference || null) === next.corporateAgentReference
        && (current.agreement_reference || null) === next.agreementReference
        && (current.expires_at || null) === next.expiresAt) {
      return reply({ data: current, idempotentReplay: true }, 200, requestId);
    }
    const after = {
      ...current,
      corporate_agent_reference: next.corporateAgentReference,
      agreement_reference: next.agreementReference,
      onboarding_status: next.onboardingStatus,
      expires_at: next.expiresAt,
    };
    const statements = [
      env.DB.prepare(
        "UPDATE provider_relationships SET corporate_agent_reference=?1,agreement_reference=?2,onboarding_status=?3,approved_at=CASE WHEN ?3='ACTIVE' THEN COALESCE(approved_at,CURRENT_TIMESTAMP) ELSE approved_at END,expires_at=?4,updated_at=CURRENT_TIMESTAMP WHERE company_id=?5 AND id=?6 AND onboarding_status=?7"
      ).bind(next.corporateAgentReference, next.agreementReference, next.onboardingStatus, next.expiresAt, companyId, id, current.onboarding_status),
    ];
    if (["SUSPENDED", "CLOSED"].includes(next.onboardingStatus)) {
      const childStatus = next.onboardingStatus;
      const operatorStatus = childStatus === "CLOSED" ? "REVOKED" : "SUSPENDED";
      const grantStatus = childStatus === "CLOSED" ? "REVOKED" : "SUSPENDED";
      statements.push(
        env.DB.prepare("UPDATE provider_outlet_accounts SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND provider_relationship_id=?3 AND status<>'CLOSED'").bind(childStatus === "CLOSED" ? "CLOSED" : "SUSPENDED", companyId, id),
        env.DB.prepare("UPDATE provider_operator_profiles SET approval_status=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND provider_relationship_id=?3 AND approval_status='APPROVED'").bind(operatorStatus, companyId, id),
        env.DB.prepare("UPDATE employee_permission_grants SET status=?1 WHERE company_id=?2 AND scope_type='PROVIDER_ACCOUNT' AND scope_id IN (SELECT id FROM provider_outlet_accounts WHERE company_id=?2 AND provider_relationship_id=?3) AND status IN ('ACTIVE','SUSPENDED')").bind(grantStatus, companyId, id),
      );
    }
    statements.push(auditStatement(env, { companyId, actorId, action: "PROVIDER_RELATIONSHIP_STATUS_CHANGED", entityType: "PROVIDER_RELATIONSHIP", entityId: id, reason: next.reason, requestId, beforeState: current, afterState: after }));
    try {
      const result = await env.DB.batch(statements);
      if (Number(result?.[0]?.meta?.changes || 0) !== 1) return reply({ error: "provider_relationship_changed_retry" }, 409, requestId);
      return reply({ data: after }, 200, requestId);
    } catch (error) {
      console.error("[opoint] provider relationship status update failed", { type: error?.name || "Error" });
      return reply({ error: "provider_relationship_status_update_failed" }, 500, requestId);
    }
  }

  if (path === "/v1/provider-outlet-accounts" && request.method === "GET") {
    const providerCode = clean(url.searchParams.get("providerCode"), 40).toUpperCase() || null;
    const branchId = clean(url.searchParams.get("branchId"), 80) || null;
    if (providerCode && !PROVIDERS.includes(providerCode)) return reply({ error: "unsupported_provider" }, 400, requestId);
    const rows = await env.DB.prepare(
      "SELECT a.id,a.provider_relationship_id,r.provider_code,a.branch_id,b.name AS branch_name,a.cash_account_id,a.outlet_account_reference,a.account_kind,a.display_name,a.currency,a.status,a.approved_at,a.created_at FROM provider_outlet_accounts a JOIN provider_relationships r ON r.company_id=a.company_id AND r.id=a.provider_relationship_id JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.scope_type='OUTLET' AND (?2 IS NULL OR r.provider_code=?2) AND (?3 IS NULL OR a.branch_id=?3) ORDER BY r.provider_code,b.name,a.account_kind LIMIT 200"
    ).bind(companyId, providerCode, branchId).all();
    return reply({ data: rows.results || [] }, 200, requestId);
  }

  if (path === "/v1/provider-outlet-accounts" && request.method === "POST") {
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeOutletAccount(parsed.value);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const input = normalized.value;
    const [relationship, branch, cash] = await Promise.all([
      env.DB.prepare(
        "SELECT id,provider_code,onboarding_status FROM provider_relationships WHERE company_id=?1 AND id=?2 LIMIT 1"
      ).bind(companyId, input.providerRelationshipId).first(),
      env.DB.prepare(
        "SELECT id FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
      ).bind(companyId, input.branchId).first(),
      input.cashAccountId ? env.DB.prepare(
        "SELECT id,branch_id,account_type,provider_code FROM cash_accounts WHERE company_id=?1 AND id=?2 LIMIT 1"
      ).bind(companyId, input.cashAccountId).first() : Promise.resolve(null),
    ]);
    if (!relationship || relationship.onboarding_status === "CLOSED") return reply({ error: "provider_relationship_not_available" }, 409, requestId);
    if (!branch) return reply({ error: "active_branch_required" }, 409, requestId);
    if (input.cashAccountId && (!cash || cash.branch_id !== input.branchId || !["MOBILE_MONEY", "PROVIDER_FLOAT"].includes(cash.account_type))) {
      return reply({ error: "cash_account_must_be_mobile_money_float_at_same_branch" }, 409, requestId);
    }
    if (cash && ((relationship.provider_code === "AIRTEL_MONEY" && cash.provider_code !== "AIRTEL_MONEY")
      || (relationship.provider_code === "MTN_MOMO" && cash.provider_code !== "MTN_MOMO"))) {
      return reply({ error: "cash_account_provider_mismatch" }, 409, requestId);
    }
    const prior = await env.DB.prepare(
      "SELECT id,display_name,status FROM provider_outlet_accounts WHERE company_id=?1 AND provider_relationship_id=?2 AND branch_id=?3 AND account_kind=?4 AND outlet_account_reference=?5 LIMIT 1"
    ).bind(companyId, input.providerRelationshipId, input.branchId, input.accountKind, input.outletAccountReference).first();
    if (prior) {
      if (prior.display_name === input.displayName) return reply({ data: prior, idempotentReplay: true }, 200, requestId);
      return reply({ error: "provider_outlet_account_reference_already_used" }, 409, requestId);
    }
    const id = crypto.randomUUID();
    const after = { id, providerRelationshipId: input.providerRelationshipId, branchId: input.branchId, accountKind: input.accountKind, outletAccountReference: input.outletAccountReference, displayName: input.displayName, status: "PENDING" };
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO provider_outlet_accounts (id,company_id,provider_relationship_id,scope_type,branch_id,cash_account_id,outlet_account_reference,account_kind,display_name,status) VALUES (?1,?2,?3,'OUTLET',?4,?5,?6,?7,?8,'PENDING')"
        ).bind(id, companyId, input.providerRelationshipId, input.branchId, input.cashAccountId, input.outletAccountReference, input.accountKind, input.displayName),
        auditStatement(env, { companyId, actorId, action: "PROVIDER_OUTLET_ACCOUNT_CREATED", entityType: "PROVIDER_OUTLET_ACCOUNT", entityId: id, reason: input.reason, requestId, beforeState: null, afterState: after }),
      ]);
      return reply({ data: after }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return reply({ error: "provider_outlet_account_conflict" }, 409, requestId);
      console.error("[opoint] provider outlet create failed", { type: error?.name || "Error" });
      return reply({ error: "provider_outlet_account_create_failed" }, 500, requestId);
    }
  }

  const outletStatus = path.match(/^\/v1\/provider-outlet-accounts\/([A-Za-z0-9._:-]{1,80})\/status$/);
  const outletOperators = path.match(/^\/v1\/provider-outlet-accounts\/([A-Za-z0-9._:-]{1,80})\/operators$/);
  const operatorStatus = path.match(/^\/v1\/provider-operator-profiles\/([A-Za-z0-9._:-]{1,80})\/status$/);

  if (outletStatus && request.method === "POST") {
    const id = decodeURIComponent(outletStatus[1]);
    const current = await providerOutletContext(env, companyId, id);
    if (!current) return reply({ error: "provider_outlet_account_not_found" }, 404, requestId);
    if (current.status === "CLOSED") return reply({ error: "closed_provider_outlet_account_is_terminal" }, 409, requestId);
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeOutletStatus(parsed.value);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const next = normalized.value;
    if (current.status === next.status) return reply({ data: current, idempotentReplay: true }, 200, requestId);
    if (next.status === "ACTIVE" && (current.onboarding_status !== "ACTIVE" || (current.expires_at && Date.parse(current.expires_at) <= Date.now()) || !current.outlet_account_reference)) {
      return reply({ error: "active_provider_relationship_and_outlet_reference_required" }, 409, requestId);
    }
    const statements = [
      env.DB.prepare(
        "UPDATE provider_outlet_accounts SET status=?1,approved_at=CASE WHEN ?1='ACTIVE' THEN COALESCE(approved_at,CURRENT_TIMESTAMP) ELSE approved_at END,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND status=?4"
      ).bind(next.status, companyId, id, current.status),
    ];
    if (next.status !== "ACTIVE") {
      const revoke = next.status === "CLOSED";
      statements.push(
        env.DB.prepare("UPDATE provider_operator_profiles SET approval_status=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND provider_outlet_account_id=?3 AND approval_status IN ('APPROVED','PENDING','SUSPENDED')").bind(revoke ? "REVOKED" : "SUSPENDED", companyId, id),
        env.DB.prepare("UPDATE employee_permission_grants SET status=?1 WHERE company_id=?2 AND scope_type='PROVIDER_ACCOUNT' AND scope_id=?3 AND status IN ('ACTIVE','SUSPENDED')").bind(revoke ? "REVOKED" : "SUSPENDED", companyId, id),
      );
    }
    statements.push(auditStatement(env, { companyId, actorId, action: "PROVIDER_OUTLET_ACCOUNT_STATUS_CHANGED", entityType: "PROVIDER_OUTLET_ACCOUNT", entityId: id, reason: next.reason, requestId, beforeState: current, afterState: { ...current, status: next.status } }));
    try {
      const result = await env.DB.batch(statements);
      if (Number(result?.[0]?.meta?.changes || 0) !== 1) return reply({ error: "provider_outlet_account_changed_retry" }, 409, requestId);
      return reply({ data: { ...current, status: next.status } }, 200, requestId);
    } catch (error) {
      console.error("[opoint] provider outlet status change failed", { type: error?.name || "Error" });
      return reply({ error: "provider_outlet_account_status_change_failed" }, 500, requestId);
    }
  }

  if (outletOperators && request.method === "GET") {
    const id = decodeURIComponent(outletOperators[1]);
    const current = await providerOutletContext(env, companyId, id);
    if (!current) return reply({ error: "provider_outlet_account_not_found" }, 404, requestId);
    const rows = await env.DB.prepare(
      "SELECT op.id,op.provider_operator_reference,op.approval_status,op.training_status,op.approved_at,op.training_completed_at,op.valid_until,ep.employee_number,sm.display_name,op.sim_asset_id FROM provider_operator_profiles op JOIN employee_profiles ep ON ep.company_id=op.company_id AND ep.id=op.employee_profile_id JOIN staff_memberships sm ON sm.company_id=ep.company_id AND sm.id=ep.staff_membership_id WHERE op.company_id=?1 AND op.provider_outlet_account_id=?2 ORDER BY sm.display_name LIMIT 200"
    ).bind(companyId, id).all();
    return reply({ data: rows.results || [] }, 200, requestId);
  }

  if (outletOperators && request.method === "POST") {
    const id = decodeURIComponent(outletOperators[1]);
    const account = await providerOutletContext(env, companyId, id);
    if (!account || account.status !== "ACTIVE" || account.onboarding_status !== "ACTIVE" || (account.expires_at && Date.parse(account.expires_at) <= Date.now())) {
      return reply({ error: "active_provider_outlet_and_relationship_required" }, 409, requestId);
    }
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderOperator(parsed.value);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const input = normalized.value;
    const employee = await requireActiveEmployeeAtBranch(env, companyId, input.employeeProfileId, account.branch_id);
    if (!employee) return reply({ error: "active_employee_assignment_at_provider_branch_required" }, 409, requestId);
    const workDuty = await requireMobileMoneyDuty(env, companyId, employee.staff_membership_id, account.branch_id);
    if (!workDuty) return reply({ error: "active_mobile_money_operator_assignment_required" }, 409, requestId);
    const sim = await validateAssignedSim(env, companyId, account.provider_code, input.employeeProfileId, account.branch_id, input.simAssetId);
    if (!sim.ok) return reply({ error: sim.error }, 409, requestId);
    const existing = await env.DB.prepare(
      "SELECT id,provider_operator_reference,approval_status,training_status FROM provider_operator_profiles WHERE company_id=?1 AND provider_outlet_account_id=?2 AND employee_profile_id=?3 AND approval_status IN ('PENDING','APPROVED','SUSPENDED') LIMIT 1"
    ).bind(companyId, id, input.employeeProfileId).first();
    if (existing) {
      if (existing.provider_operator_reference === input.providerOperatorReference) return reply({ data: existing, idempotentReplay: true }, 200, requestId);
      return reply({ error: "employee_already_assigned_to_provider_outlet" }, 409, requestId);
    }
    const profileId = crypto.randomUUID();
    const after = { id: profileId, providerRelationshipId: account.provider_relationship_id, providerOutletAccountId: id, employeeProfileId: input.employeeProfileId, providerOperatorReference: input.providerOperatorReference, simAssetId: input.simAssetId, approvalStatus: "PENDING", trainingStatus: "NOT_STARTED" };
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO provider_operator_profiles (id,company_id,provider_relationship_id,provider_outlet_account_id,employee_profile_id,provider_operator_reference,sim_asset_id,approval_status,training_status) VALUES (?1,?2,?3,?4,?5,?6,?7,'PENDING','NOT_STARTED')"
        ).bind(profileId, companyId, account.provider_relationship_id, id, input.employeeProfileId, input.providerOperatorReference, input.simAssetId),
        auditStatement(env, { companyId, actorId, action: "PROVIDER_OPERATOR_PROFILE_CREATED", entityType: "PROVIDER_OPERATOR_PROFILE", entityId: profileId, reason: input.reason, requestId, beforeState: null, afterState: after }),
      ]);
      return reply({ data: after }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return reply({ error: "provider_operator_profile_conflict" }, 409, requestId);
      console.error("[opoint] provider operator profile create failed", { type: error?.name || "Error" });
      return reply({ error: "provider_operator_profile_create_failed" }, 500, requestId);
    }
  }

  if (operatorStatus && request.method === "POST") {
    const id = decodeURIComponent(operatorStatus[1]);
    const current = await env.DB.prepare(
      "SELECT op.id,op.provider_relationship_id,op.provider_outlet_account_id,op.employee_profile_id,op.provider_operator_reference,op.sim_asset_id,op.approval_status,op.training_status,op.valid_until,poa.branch_id,poa.status AS outlet_status,pr.provider_code,pr.onboarding_status,pr.expires_at FROM provider_operator_profiles op JOIN provider_outlet_accounts poa ON poa.company_id=op.company_id AND poa.id=op.provider_outlet_account_id JOIN provider_relationships pr ON pr.company_id=op.company_id AND pr.id=op.provider_relationship_id WHERE op.company_id=?1 AND op.id=?2 LIMIT 1"
    ).bind(companyId, id).first();
    if (!current) return reply({ error: "provider_operator_profile_not_found" }, 404, requestId);
    if (["REVOKED", "REJECTED"].includes(current.approval_status)) return reply({ error: "rejected_or_revoked_operator_profile_is_terminal" }, 409, requestId);
    const parsed = await readBody(request);
    if (parsed.error) return reply({ error: parsed.error }, parsed.status, requestId);
    const normalized = normalizeProviderOperatorStatus(parsed.value, current);
    if (normalized.error) return reply({ error: normalized.error }, 400, requestId);
    const next = normalized.value;
    if (next.approvalStatus === "APPROVED") {
      if (current.outlet_status !== "ACTIVE" || current.onboarding_status !== "ACTIVE" || (current.expires_at && Date.parse(current.expires_at) <= Date.now())) return reply({ error: "provider_outlet_and_relationship_must_be_active" }, 409, requestId);
      const employee = await requireActiveEmployeeAtBranch(env, companyId, current.employee_profile_id, current.branch_id);
      if (!employee) return reply({ error: "active_employee_assignment_at_provider_branch_required" }, 409, requestId);
      const workDuty = await requireMobileMoneyDuty(env, companyId, employee.staff_membership_id, current.branch_id);
      if (!workDuty) return reply({ error: "active_mobile_money_operator_assignment_required" }, 409, requestId);
      const sim = await validateAssignedSim(env, companyId, current.provider_code, current.employee_profile_id, current.branch_id, current.sim_asset_id);
      if (!sim.ok) return reply({ error: sim.error }, 409, requestId);
    }
    const nextGrantStatus = next.approvalStatus === "APPROVED" && next.trainingStatus === "COMPLETED"
      ? "ACTIVE"
      : ["REJECTED", "REVOKED"].includes(next.approvalStatus) ? "REVOKED" : "SUSPENDED";
    const approvedAt = next.approvalStatus === "APPROVED" ? new Date().toISOString() : null;
    const trainingCompletedAt = next.trainingStatus === "COMPLETED" ? new Date().toISOString() : null;
    const before = { approvalStatus: current.approval_status, trainingStatus: current.training_status, providerOperatorReference: current.provider_operator_reference };
    const after = { approvalStatus: next.approvalStatus, trainingStatus: next.trainingStatus, providerOperatorReference: next.providerOperatorReference, validUntil: next.validUntil };
    const statements = [
      env.DB.prepare(
        "UPDATE provider_operator_profiles SET approval_status=?1,training_status=?2,provider_operator_reference=?3,valid_until=?4,approved_at=CASE WHEN ?1='APPROVED' THEN COALESCE(approved_at,?5) ELSE approved_at END,training_completed_at=CASE WHEN ?2='COMPLETED' THEN COALESCE(training_completed_at,?6) ELSE training_completed_at END,updated_at=CURRENT_TIMESTAMP WHERE company_id=?7 AND id=?8"
      ).bind(next.approvalStatus, next.trainingStatus, next.providerOperatorReference, next.validUntil, approvedAt, trainingCompletedAt, companyId, id),
    ];
    if (nextGrantStatus === "ACTIVE") {
      statements.push(
        env.DB.prepare(
          "UPDATE employee_permission_grants SET status='ACTIVE',starts_at=CURRENT_TIMESTAMP,expires_at=?1 WHERE company_id=?2 AND employee_profile_id=?3 AND permission_key=?4 AND scope_type='PROVIDER_ACCOUNT' AND scope_id=?5 AND status IN ('ACTIVE','SUSPENDED','EXPIRED')"
        ).bind(next.validUntil, companyId, current.employee_profile_id, OPERATING_GRANT, current.provider_outlet_account_id),
        env.DB.prepare(
          "INSERT INTO employee_permission_grants (id,company_id,employee_profile_id,permission_key,scope_type,scope_id,status,granted_by,reason,expires_at) SELECT ?1,?2,?3,?4,'PROVIDER_ACCOUNT',?5,'ACTIVE',?6,?7,?8 WHERE NOT EXISTS (SELECT 1 FROM employee_permission_grants WHERE company_id=?2 AND employee_profile_id=?3 AND permission_key=?4 AND scope_type='PROVIDER_ACCOUNT' AND scope_id=?5 AND status='ACTIVE')"
        ).bind(crypto.randomUUID(), companyId, current.employee_profile_id, OPERATING_GRANT, current.provider_outlet_account_id, actorId, next.reason, next.validUntil),
      );
    } else {
      statements.push(
        env.DB.prepare(
          "UPDATE employee_permission_grants SET status=?1 WHERE company_id=?2 AND employee_profile_id=?3 AND permission_key=?4 AND scope_type='PROVIDER_ACCOUNT' AND scope_id=?5 AND status IN ('ACTIVE','SUSPENDED')"
        ).bind(nextGrantStatus, companyId, current.employee_profile_id, OPERATING_GRANT, current.provider_outlet_account_id),
      );
    }
    statements.push(auditStatement(env, { companyId, actorId, action: "PROVIDER_OPERATOR_PROFILE_STATUS_CHANGED", entityType: "PROVIDER_OPERATOR_PROFILE", entityId: id, reason: next.reason, requestId, beforeState: before, afterState: after }));
    try {
      await env.DB.batch(statements);
      return reply({ data: { id, ...after } }, 200, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return reply({ error: "provider_operator_permission_conflict" }, 409, requestId);
      console.error("[opoint] provider operator status change failed", { type: error?.name || "Error" });
      return reply({ error: "provider_operator_status_change_failed" }, 500, requestId);
    }
  }

  return reply({ error: "route_not_found" }, 404, requestId);
}

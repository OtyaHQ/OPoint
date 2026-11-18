const INVITATION_ROLES = new Set([
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "AGENT",
  "ACCOUNTANT",
  "AUDITOR",
]);
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const INVITATION_EMAIL_PATH = "/internal/notifications/otyapoint/staff-invitation";

function response(body, status = 200, requestId) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
}

function clean(value, max = 160) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : "";
}

async function readBody(request, maxBytes = 8192) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "invalid_json_object", status: 400 };
    }
    return { value };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function newInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveSecret(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value.get !== "function") return "";
  try {
    const secret = await value.get();
    return typeof secret === "string" ? secret : "";
  } catch {
    return "";
  }
}


function membershipEventInsert(env, { companyId, membershipId, eventType, previousStatus, newStatus, actorId, reason }) {
  return env.DB.prepare(
    "INSERT INTO staff_membership_events (id,company_id,staff_membership_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
  ).bind(
    crypto.randomUUID(),
    companyId,
    membershipId,
    eventType,
    previousStatus ?? null,
    newStatus,
    actorId,
    reason ?? null,
  );
}

function auditInsert(env, { companyId, actorId, action, entityId, reason, requestId, after }) {
  return env.DB.prepare(
    "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) VALUES (?1,?2,?3,?4,'STAFF_INVITATION',?5,?6,?7,NULL,?8)"
  ).bind(
    crypto.randomUUID(),
    companyId,
    actorId,
    action,
    entityId,
    reason,
    requestId,
    after ? JSON.stringify(after) : null,
  );
}

function eventInsert(env, { companyId, invitationId, eventType, previousStatus, newStatus, actorId, reason }) {
  return env.DB.prepare(
    "INSERT INTO staff_invitation_events (id,company_id,invitation_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
  ).bind(
    crypto.randomUUID(),
    companyId,
    invitationId,
    eventType,
    previousStatus ?? null,
    newStatus ?? null,
    actorId,
    reason ?? null,
  );
}

async function markDelivery(env, invitation, actorId, requestId, status, reason) {
  const eventType = status === "SENT" ? "EMAIL_SENT" : "EMAIL_FAILED";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE staff_invitations SET delivery_status=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND delivery_status='PENDING'"
    ).bind(status, invitation.company_id, invitation.id),
    eventInsert(env, {
      companyId: invitation.company_id,
      invitationId: invitation.id,
      eventType,
      previousStatus: invitation.status,
      newStatus: invitation.status,
      actorId,
      reason,
    }),
    auditInsert(env, {
      companyId: invitation.company_id,
      actorId,
      action: status === "SENT" ? "STAFF_INVITATION_EMAIL_SENT" : "STAFF_INVITATION_EMAIL_FAILED",
      entityId: invitation.id,
      reason,
      requestId,
      after: { status: invitation.status, deliveryStatus: status },
    }),
  ]);
}

async function deliverInvitation(requestEnv, invitation, token, expiresAt) {
  const serviceToken = await resolveSecret(requestEnv.OTYAPOINT_INVITE_SERVICE_TOKEN);
  if (serviceToken.length < 32 || serviceToken.length > 512) {
    return { ok: false, code: "invitation_email_not_configured" };
  }
  if (!requestEnv.OTYA_ID?.fetch) {
    return { ok: false, code: "identity_service_unavailable" };
  }
  try {
    const result = await requestEnv.OTYA_ID.fetch(new Request(
      "https://auth" + INVITATION_EMAIL_PATH,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-otya-service": "otyapoint",
          "x-otya-service-token": serviceToken,
        },
        body: JSON.stringify({
          invitationId: invitation.id,
          email: invitation.email,
          displayName: invitation.display_name,
          role: invitation.role_key,
          token,
          expiresAt,
        }),
        signal: AbortSignal.timeout(8000),
      },
    ));
    if (!result.ok) return { ok: false, code: "invitation_email_delivery_failed" };
    const body = await result.json().catch(() => ({}));
    return body?.accepted === true
      ? { ok: true }
      : { ok: false, code: "invitation_email_delivery_failed" };
  } catch {
    return { ok: false, code: "invitation_email_delivery_failed" };
  }
}

export async function handleStaffInvitationAcceptance(request, env, identity, url, requestId) {
  if (url.pathname !== "/v1/staff/invitations/accept") return null;
  if (request.method !== "POST") return response({ error: "method_not_allowed", requestId }, 405, requestId);
  if (identity.emailVerified !== true || !identity.email) {
    return response({ error: "verified_account_email_required", requestId }, 403, requestId);
  }

  const parsed = await readBody(request, 4096);
  if (parsed.error) return response({ error: parsed.error, requestId }, parsed.status, requestId);
  const token = clean(parsed.value.token, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return response({ error: "invalid_invitation_token", requestId }, 400, requestId);
  }

  const email = clean(identity.email, 254).toLowerCase();
  const tokenDigest = await sha256Hex(token);
  const invitation = await env.DB.prepare(
    "SELECT i.id,i.company_id,i.email_normalized,i.display_name,i.branch_id,i.role_key,i.status,i.expires_at,c.status AS company_status,b.status AS branch_status FROM staff_invitations i JOIN companies c ON c.id=i.company_id LEFT JOIN branches b ON b.company_id=i.company_id AND b.id=i.branch_id WHERE i.token_digest=?1 AND i.status='PENDING' LIMIT 1"
  ).bind(tokenDigest).first();

  if (!invitation) return response({ error: "invitation_not_found_or_used", requestId }, 404, requestId);
  if (invitation.email_normalized !== email) {
    return response({ error: "invitation_email_mismatch", requestId }, 403, requestId);
  }
  if (!["SETUP", "ACTIVE"].includes(invitation.company_status)
    || (invitation.branch_id && invitation.branch_status !== "ACTIVE")) {
    return response({ error: "invitation_scope_unavailable", requestId }, 409, requestId);
  }

  const expiresAt = Date.parse(invitation.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE staff_invitations SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE company_id=?1 AND id=?2 AND status='PENDING'"
      ).bind(invitation.company_id, invitation.id),
      eventInsert(env, {
        companyId: invitation.company_id,
        invitationId: invitation.id,
        eventType: "EXPIRED",
        previousStatus: "PENDING",
        newStatus: "EXPIRED",
        actorId: identity.userId,
        reason: "Invitation expired before redemption",
      }),
      auditInsert(env, {
        companyId: invitation.company_id,
        actorId: identity.userId,
        action: "STAFF_INVITATION_EXPIRED",
        entityId: invitation.id,
        reason: "Invitation expired before redemption",
        requestId,
        after: { status: "EXPIRED" },
      }),
    ]);
    return response({ error: "invitation_expired", requestId }, 410, requestId);
  }

  const existingMembership = await env.DB.prepare(
    "SELECT id,status FROM staff_memberships WHERE company_id=?1 AND (identity_subject=?2 OR lower(trim(COALESCE(email,'')))=?3) LIMIT 1"
  ).bind(invitation.company_id, identity.userId, email).first();
  if (existingMembership) {
    return response({ error: "company_membership_already_exists", requestId }, 409, requestId);
  }

  const membershipId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO staff_memberships (id,company_id,branch_id,identity_subject,display_name,email,role_key,status,created_by,last_updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,'PENDING',?8,?9)"
      ).bind(
        membershipId,
        invitation.company_id,
        invitation.branch_id,
        identity.userId,
        invitation.display_name,
        email,
        invitation.role_key,
        "staff-invitation:" + invitation.id,
        identity.userId,
      ),
      membershipEventInsert(env, {
        companyId: invitation.company_id,
        membershipId,
        eventType: "INVITATION_ACCEPTED",
        previousStatus: null,
        newStatus: "PENDING",
        actorId: identity.userId,
        reason: "Verified account redeemed email-bound staff invitation",
      }),
      env.DB.prepare(
        "UPDATE staff_invitations SET status='ACCEPTED',accepted_membership_id=?1,accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND status='PENDING'"
      ).bind(membershipId, invitation.company_id, invitation.id),
      eventInsert(env, {
        companyId: invitation.company_id,
        invitationId: invitation.id,
        eventType: "ACCEPTED",
        previousStatus: "PENDING",
        newStatus: "ACCEPTED",
        actorId: identity.userId,
        reason: "Verified account redeemed an email-bound invitation; membership remains pending",
      }),
      auditInsert(env, {
        companyId: invitation.company_id,
        actorId: identity.userId,
        action: "STAFF_INVITATION_ACCEPTED",
        entityId: invitation.id,
        reason: "Verified account redeemed an email-bound invitation; membership remains pending",
        requestId,
        after: { membershipId, roleKey: invitation.role_key, membershipStatus: "PENDING" },
      }),
    ]);
    return response({
      data: {
        companyId: invitation.company_id,
        membershipId,
        roleKey: invitation.role_key,
        status: "PENDING",
      },
      message: "Invitation accepted. The company administrator must activate your membership before you can access company operations.",
      requestId,
    }, 201, requestId);
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed")) {
      return response({ error: "company_membership_already_exists", requestId }, 409, requestId);
    }
    console.error("[opoint] staff invitation acceptance failed", { type: error?.name || "Error" });
    return response({ error: "staff_invitation_acceptance_failed", requestId }, 500, requestId);
  }
}

export async function handleStaffInvitationManagement(request, env, identity, membership, url, requestId) {
  const listPath = url.pathname === "/v1/staff/invitations";
  const createPath = listPath && request.method === "POST";
  const readPath = listPath && request.method === "GET";
  const revokeMatch = url.pathname.match(/^\/v1\/staff\/invitations\/([A-Za-z0-9._:-]{1,80})\/revoke$/);
  if (!createPath && !readPath && !(revokeMatch && request.method === "POST")) return null;

  if (!["OWNER", "ADMIN"].includes(membership.role_key)) {
    return response({ error: "staff_invitation_management_forbidden", requestId }, 403, requestId);
  }

  const companyId = membership.company_id;
  if (readPath) {
    const branchId = clean(url.searchParams.get("branchId"), 80) || null;
    if (branchId) {
      const branch = await env.DB.prepare(
        "SELECT id FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
      ).bind(companyId, branchId).first();
      if (!branch) return response({ error: "active_branch_required", requestId }, 404, requestId);
    }
    const rows = await env.DB.prepare(
      "SELECT i.id,i.email,i.display_name,i.branch_id,b.name AS branch_name,i.role_key,i.status,i.delivery_status,i.expires_at,i.created_at,i.accepted_at,i.revoked_at FROM staff_invitations i LEFT JOIN branches b ON b.company_id=i.company_id AND b.id=i.branch_id WHERE i.company_id=?1 AND (?2 IS NULL OR i.branch_id=?2) ORDER BY i.created_at DESC LIMIT 200"
    ).bind(companyId, branchId).all();
    return response({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (createPath) {
    const parsed = await readBody(request);
    if (parsed.error) return response({ error: parsed.error, requestId }, parsed.status, requestId);
    const email = clean(parsed.value.email, 254).toLowerCase();
    const displayName = clean(parsed.value.displayName, 120);
    const roleKey = clean(parsed.value.roleKey, 24).toUpperCase();
    const branchId = clean(parsed.value.branchId, 80) || null;

    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      return response({ error: "invalid_invitation_email", requestId }, 400, requestId);
    }
    if (!displayName) return response({ error: "display_name_required", requestId }, 400, requestId);
    if (!INVITATION_ROLES.has(roleKey)) {
      return response({ error: "invalid_invitation_role", requestId }, 400, requestId);
    }
    if (roleKey === "ADMIN" && membership.role_key !== "OWNER") {
      return response({ error: "owner_required_to_invite_admin", requestId }, 403, requestId);
    }
    if (branchId) {
      const branch = await env.DB.prepare(
        "SELECT id FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
      ).bind(companyId, branchId).first();
      if (!branch) return response({ error: "active_branch_required", requestId }, 404, requestId);
    }

    const existingMembership = await env.DB.prepare(
      "SELECT id,status FROM staff_memberships WHERE company_id=?1 AND lower(trim(COALESCE(email,'')))=?2 LIMIT 1"
    ).bind(companyId, email).first();
    if (existingMembership) {
      return response({ error: "company_membership_already_exists", requestId }, 409, requestId);
    }
    const existingInvitation = await env.DB.prepare(
      "SELECT id,status,delivery_status FROM staff_invitations WHERE company_id=?1 AND email_normalized=?2 AND status='PENDING' LIMIT 1"
    ).bind(companyId, email).first();
    if (existingInvitation) {
      return response({ error: "pending_invitation_already_exists", requestId }, 409, requestId);
    }

    const invitationId = crypto.randomUUID();
    const token = newInvitationToken();
    const tokenDigest = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    const invitation = {
      id: invitationId,
      company_id: companyId,
      email,
      display_name: displayName,
      branch_id: branchId,
      role_key: roleKey,
      status: "PENDING",
      delivery_status: "PENDING",
    };

    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO staff_invitations (id,company_id,email,email_normalized,display_name,branch_id,role_key,token_digest,status,delivery_status,invited_by,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'PENDING','PENDING',?9,?10)"
        ).bind(
          invitationId, companyId, email, email, displayName, branchId, roleKey,
          tokenDigest, membership.membership_id, expiresAt,
        ),
        eventInsert(env, {
          companyId,
          invitationId,
          eventType: "CREATED",
          previousStatus: null,
          newStatus: "PENDING",
          actorId: identity.userId,
          reason: "Owner/Admin created an email-bound staff invitation",
        }),
        auditInsert(env, {
          companyId,
          actorId: identity.userId,
          action: "STAFF_INVITATION_CREATED",
          entityId: invitationId,
          reason: "Owner/Admin created an email-bound staff invitation",
          requestId,
          after: { email, displayName, roleKey, branchId, expiresAt, status: "PENDING" },
        }),
      ]);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) {
        return response({ error: "pending_invitation_already_exists", requestId }, 409, requestId);
      }
      console.error("[opoint] staff invitation creation failed", { type: error?.name || "Error" });
      return response({ error: "staff_invitation_creation_failed", requestId }, 500, requestId);
    }

    const delivery = await deliverInvitation(env, invitation, token, expiresAt);
    const deliveryStatus = delivery.ok ? "SENT" : "FAILED";
    try {
      await markDelivery(
        env,
        invitation,
        identity.userId,
        requestId,
        deliveryStatus,
        delivery.ok ? "Invitation email accepted by Otya Auth" : delivery.code,
      );
    } catch (error) {
      console.error("[opoint] staff invitation delivery audit failed", { type: error?.name || "Error" });
      return response({ error: "staff_invitation_delivery_state_failed", invitationId, requestId }, 503, requestId);
    }

    if (!delivery.ok) {
      return response({
        error: delivery.code,
        invitation: {
          id: invitationId,
          email,
          roleKey,
          status: "PENDING",
          deliveryStatus: "FAILED",
          expiresAt,
        },
        requestId,
      }, 503, requestId);
    }

    return response({
      data: {
        id: invitationId,
        email,
        displayName,
        roleKey,
        branchId,
        status: "PENDING",
        deliveryStatus: "SENT",
        expiresAt,
      },
      requestId,
    }, 201, requestId);
  }

  const invitationId = decodeURIComponent(revokeMatch[1]);
  const parsed = await readBody(request);
  if (parsed.error) return response({ error: parsed.error, requestId }, parsed.status, requestId);
  const reason = clean(parsed.value.reason, 300);
  if (reason.length < 4) return response({ error: "reason_required", requestId }, 400, requestId);

  const current = await env.DB.prepare(
    "SELECT id,status,delivery_status,email,role_key FROM staff_invitations WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(companyId, invitationId).first();
  if (!current) return response({ error: "staff_invitation_not_found", requestId }, 404, requestId);
  if (current.status !== "PENDING") {
    return response({ error: "staff_invitation_not_pending", requestId }, 409, requestId);
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE staff_invitations SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE company_id=?1 AND id=?2 AND status='PENDING'"
    ).bind(companyId, invitationId),
    eventInsert(env, {
      companyId,
      invitationId,
      eventType: "REVOKED",
      previousStatus: "PENDING",
      newStatus: "REVOKED",
      actorId: identity.userId,
      reason,
    }),
    auditInsert(env, {
      companyId,
      actorId: identity.userId,
      action: "STAFF_INVITATION_REVOKED",
      entityId: invitationId,
      reason,
      requestId,
      after: { status: "REVOKED", email: current.email, roleKey: current.role_key },
    }),
  ]);
  return response({ data: { id: invitationId, status: "REVOKED" }, requestId }, 200, requestId);
}


export async function handleStaffMembershipStatusManagement(request, env, identity, membership, url, requestId) {
  const match = url.pathname.match(/^\/v1\/staff\/([A-Za-z0-9._:-]{1,80})\/status$/);
  if (!match || request.method !== "POST") return null;
  if (!["OWNER", "ADMIN"].includes(membership.role_key)) {
    return response({ error: "staff_membership_management_forbidden", requestId }, 403, requestId);
  }

  const parsed = await readBody(request, 4096);
  if (parsed.error) return response({ error: parsed.error, requestId }, parsed.status, requestId);
  const status = clean(parsed.value.status, 24).toUpperCase();
  const reason = clean(parsed.value.reason, 300);
  if (!["ACTIVE", "SUSPENDED", "REVOKED"].includes(status)) {
    return response({ error: "invalid_staff_membership_status", requestId }, 400, requestId);
  }
  if (reason.length < 4) return response({ error: "reason_required", requestId }, 400, requestId);

  const targetId = decodeURIComponent(match[1]);
  const current = await env.DB.prepare(
    "SELECT id,identity_subject,role_key,status FROM staff_memberships WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(membership.company_id, targetId).first();
  if (!current) return response({ error: "staff_membership_not_found", requestId }, 404, requestId);
  if (current.role_key === "OWNER") {
    return response({ error: "owner_transfer_requires_separate_controlled_process", requestId }, 403, requestId);
  }
  if (current.identity_subject === identity.userId) {
    return response({ error: "self_membership_change_forbidden", requestId }, 409, requestId);
  }
  if (current.role_key === "ADMIN" && membership.role_key !== "OWNER") {
    return response({ error: "owner_required_to_manage_admin", requestId }, 403, requestId);
  }
  if (current.status === status) {
    return response({ data: { id: current.id, status }, requestId }, 200, requestId);
  }
  if (current.status === "REVOKED") {
    return response({ error: "staff_membership_revoked_terminal", requestId }, 409, requestId);
  }

  const allowedTransitions = {
    PENDING: new Set(["ACTIVE", "SUSPENDED", "REVOKED"]),
    ACTIVE: new Set(["SUSPENDED", "REVOKED"]),
    SUSPENDED: new Set(["ACTIVE", "REVOKED"]),
  };
  if (!allowedTransitions[current.status]?.has(status)) {
    return response({ error: "invalid_staff_membership_transition", requestId }, 409, requestId);
  }

  const eventType = status === "REVOKED"
    ? "REVOKED"
    : status === "SUSPENDED"
      ? "SUSPENDED"
      : current.status === "PENDING" ? "ACTIVATED" : "RESUMED";
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE staff_memberships SET status=?1,last_updated_by=?2,updated_at=CURRENT_TIMESTAMP WHERE company_id=?3 AND id=?4 AND status=?5"
      ).bind(status, identity.userId, membership.company_id, targetId, current.status),
      membershipEventInsert(env, {
        companyId: membership.company_id,
        membershipId: targetId,
        eventType,
        previousStatus: current.status,
        newStatus: status,
        actorId: identity.userId,
        reason,
      }),
      auditInsert(env, {
        companyId: membership.company_id,
        actorId: identity.userId,
        action: "STAFF_MEMBERSHIP_STATUS_CHANGED",
        entityId: targetId,
        reason,
        requestId,
        after: { status, roleKey: current.role_key, assignmentCascade: status === "SUSPENDED" || status === "REVOKED" },
      }),
    ]);
    return response({
      data: {
        id: targetId,
        status,
        workAssignments: status === "SUSPENDED"
          ? "ACTIVE assignments were automatically suspended; manual review is required before resumption."
          : status === "REVOKED"
            ? "Active and suspended assignments were automatically revoked."
            : "Membership activated; previous assignments were not automatically restored.",
      },
      requestId,
    }, 200, requestId);
  } catch (error) {
    console.error("[opoint] staff membership status change failed", { type: error?.name || "Error" });
    return response({ error: "staff_membership_status_change_failed", requestId }, 500, requestId);
  }
}

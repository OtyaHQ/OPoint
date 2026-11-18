import {
  assignmentMatchesScope,
  canManageWorkAssignments,
  WORK_AREAS,
  normalizeAssignmentStatus,
  normalizeWorkAssignment,
} from "./work-assignments.mjs";

const REQUIRED_TABLES = [
  "companies", "branches", "staff_memberships", "company_creation_requests",
  "inventory_locations", "ledger_accounts", "cash_accounts", "products", "product_categories",
  "customers", "suppliers", "stock_movements", "sales", "sale_lines", "sale_payments",
  "cash_sessions", "purchase_orders", "purchase_order_lines", "business_expenses",
  "reconciliation_sessions", "reconciliation_items", "journal_entries", "journal_lines",
  "payment_intents", "payment_attempts", "payment_reversals", "agency_operations",
  "biller_catalog", "opoint_schema_migrations", "audit_events", "integration_status",
  "staff_work_assignments", "staff_work_assignment_events",
];
const REQUIRED_GUARDS = [
  "trg_journal_post_balance_guard",
  "trg_journal_entry_update_posted_guard",
  "trg_journal_entry_delete_posted_guard",
  "trg_stock_movement_balance_guard",
];

const json = (body, status = 200, requestId = undefined) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    ...(requestId ? { "x-request-id": requestId } : {}),
  },
});

const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
  : "";

export function normalizeCompanyName(value) {
  return clean(value, 120).replace(/\s+/g, " ");
}

export function normalizeSlug(value) {
  return normalizeCompanyName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "company";
}

export function isUGXAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
}

export function maskPhone(value) {
  if (typeof value !== "string" || !value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "****";
  return "••••••" + digits.slice(-4);
}

export function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return null;
  const [local, domain] = value.split("@");
  return (local.slice(0, 1) || "*") + "***@" + domain;
}

export function parseProductInput(body) {
  const sku = clean(body?.sku, 40).toUpperCase();
  const name = clean(body?.name, 160);
  const costAmount = body?.costAmount ?? 0;
  const sellingAmount = body?.sellingAmount;
  const unitOfMeasure = clean(body?.unitOfMeasure ?? "piece", 24) || "piece";
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku)) return { error: "invalid_sku" };
  if (!name) return { error: "product_name_required" };
  if (!isUGXAmount(costAmount) || !isUGXAmount(sellingAmount)) return { error: "amounts_must_be_whole_ugx" };
  return { value: { sku, name, costAmount, sellingAmount, unitOfMeasure } };
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request, maxBytes = 16_384) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { error: "request_too_large", status: 413 };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_json_object", status: 400 };
    return { value };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

async function verifyIdentity(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 8192) return { response: json({ error: "unauthorized" }, 401) };
  if (!env.OTYA_ID?.fetch) return { response: json({ error: "identity_service_unavailable" }, 503) };
  try {
    const response = await env.OTYA_ID.fetch(new Request("https://auth/auth/verify", {
      method: "GET",
      headers: { authorization, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    }));
    if (!response.ok) return { response: json({ error: "unauthorized" }, 401) };
    const data = await response.json();
    if (data?.ok !== true || typeof data.user_id !== "string" || !data.user_id.trim()) {
      return { response: json({ error: "unauthorized" }, 401) };
    }
    return {
      identity: {
        userId: data.user_id,
        email: typeof data.email === "string" ? data.email.toLowerCase() : null,
      },
    };
  } catch {
    return { response: json({ error: "identity_service_unavailable" }, 503) };
  }
}

async function companyMemberships(env, userId) {
  const result = await env.DB.prepare(
    "SELECT sm.id AS membership_id, sm.company_id, sm.branch_id, sm.display_name, sm.email, sm.role_key, sm.status, c.slug AS company_slug, c.display_name AS company_name, c.status AS company_status, b.name AS branch_name FROM staff_memberships sm JOIN companies c ON c.id = sm.company_id LEFT JOIN branches b ON b.id = sm.branch_id AND b.company_id = sm.company_id WHERE sm.identity_subject = ?1 AND sm.status = 'ACTIVE' AND c.status IN ('SETUP','ACTIVE') ORDER BY c.display_name"
  ).bind(userId).all();
  return result.results || [];
}

async function requireMembership(env, userId, companyId) {
  if (!companyId || companyId.length > 80) return null;
  return env.DB.prepare(
    "SELECT sm.id AS membership_id, sm.company_id, sm.branch_id, sm.display_name, sm.email, sm.role_key, sm.status, c.display_name AS company_name FROM staff_memberships sm JOIN companies c ON c.id = sm.company_id WHERE sm.identity_subject = ?1 AND sm.company_id = ?2 AND sm.status = 'ACTIVE' AND c.status IN ('SETUP','ACTIVE') LIMIT 1"
  ).bind(userId, companyId).first();
}

async function requireWorkAreaAssignment(env, membership, branchId, workArea) {
  if (canManageWorkAssignments(membership.role_key)) {
    return { ok: true, assignment: null };
  }
  if (!branchId) return { ok: false, status: 400, error: "branch_selection_required" };
  if (membership.branch_id && membership.branch_id !== branchId) {
    return { ok: false, status: 403, error: "branch_access_denied" };
  }
  const assignment = await env.DB.prepare(
    "SELECT a.id,a.company_id,a.staff_membership_id,a.branch_id,a.work_area,a.duty_role,a.status FROM staff_work_assignments a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND a.staff_membership_id=?2 AND a.branch_id=?3 AND a.work_area=?4 AND a.status='ACTIVE' AND b.status='ACTIVE' LIMIT 1"
  ).bind(membership.company_id, membership.membership_id, branchId, workArea).first();
  return assignmentMatchesScope(assignment, {
    companyId: membership.company_id,
    staffMembershipId: membership.membership_id,
    branchId,
    workArea,
  }) ? { ok: true, assignment } : { ok: false, status: 403, error: "work_area_assignment_required" };
}

async function handleWorkAssignmentRoutes(request, env, identity, membership, url, requestId) {
  const listPath = url.pathname === "/v1/staff/work-assignments";
  const createPath = listPath && request.method === "POST";
  const readPath = listPath && request.method === "GET";
  const statusMatch = url.pathname.match(/^\/v1\/staff\/work-assignments\/([A-Za-z0-9._:-]{1,80})\/status$/);
  if (!createPath && !readPath && !(statusMatch && request.method === "POST")) return null;
  if (!canManageWorkAssignments(membership.role_key)) {
    return json({ error: "work_assignment_management_forbidden", requestId }, 403, requestId);
  }

  if (readPath) {
    const branchId = clean(url.searchParams.get("branchId"), 80) || null;
    if (membership.branch_id && branchId && membership.branch_id !== branchId) {
      return json({ error: "branch_access_denied", requestId }, 403, requestId);
    }
    const scopedBranchId = membership.branch_id || branchId;
    const rows = await env.DB.prepare(
      "SELECT a.id,a.staff_membership_id,sm.display_name,sm.email,sm.role_key AS membership_role,a.branch_id,b.name AS branch_name,a.work_area,a.duty_role,a.status,a.reason,a.created_by,a.created_at,a.updated_at,a.suspended_at,a.revoked_at FROM staff_work_assignments a JOIN staff_memberships sm ON sm.company_id=a.company_id AND sm.id=a.staff_membership_id JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND (?2 IS NULL OR a.branch_id=?2) ORDER BY b.name,sm.display_name,a.work_area LIMIT 500"
    ).bind(membership.company_id, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (createPath) {
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
    const normalized = normalizeWorkAssignment(parsed.value);
    if (normalized.error) return json({ error: normalized.error, requestId }, 400, requestId);
    const input = normalized.value;
    const idempotencyKey = clean(request.headers.get("idempotency-key"), 128);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return json({ error: "idempotency_key_required", requestId }, 400, requestId);
    }
    const fingerprint = await sha256(JSON.stringify(input));
    const prior = await env.DB.prepare(
      "SELECT id,request_fingerprint,status,staff_membership_id,branch_id,work_area,duty_role FROM staff_work_assignments WHERE company_id=?1 AND idempotency_key=?2 LIMIT 1"
    ).bind(membership.company_id, idempotencyKey).first();
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) {
        return json({ error: "idempotency_key_reused_with_different_request", requestId }, 409, requestId);
      }
      return json({ data: prior, idempotentReplay: true, requestId }, 200, requestId);
    }
    const [staff, branch] = await Promise.all([
      env.DB.prepare(
        "SELECT id,role_key,status FROM staff_memberships WHERE company_id=?1 AND id=?2 LIMIT 1"
      ).bind(membership.company_id, input.staffMembershipId).first(),
      env.DB.prepare(
        "SELECT id,status FROM branches WHERE company_id=?1 AND id=?2 LIMIT 1"
      ).bind(membership.company_id, input.branchId).first(),
    ]);
    if (!staff || staff.status !== "ACTIVE") return json({ error: "active_staff_membership_required", requestId }, 409, requestId);
    if (["OWNER","ADMIN"].includes(staff.role_key)) return json({ error: "privileged_members_do_not_need_work_assignments", requestId }, 400, requestId);
    if (!branch || branch.status !== "ACTIVE") return json({ error: "active_branch_required", requestId }, 409, requestId);

    const assignmentId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO staff_work_assignments (id,company_id,staff_membership_id,branch_id,work_area,duty_role,status,idempotency_key,request_fingerprint,reason,created_by) VALUES (?1,?2,?3,?4,?5,?6,'ACTIVE',?7,?8,?9,?10)"
        ).bind(assignmentId, membership.company_id, input.staffMembershipId, input.branchId, input.workArea, input.dutyRole, idempotencyKey, fingerprint, input.reason, identity.userId),
        env.DB.prepare(
          "INSERT INTO staff_work_assignment_events (id,company_id,assignment_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?1,?2,?3,'CREATED',NULL,'ACTIVE',?4,?5)"
        ).bind(eventId, membership.company_id, assignmentId, identity.userId, input.reason),
        env.DB.prepare(
          "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) VALUES (?1,?2,?3,'STAFF_WORK_ASSIGNMENT_CREATED','STAFF_WORK_ASSIGNMENT',?4,?5,?6,NULL,?7)"
        ).bind(crypto.randomUUID(), membership.company_id, identity.userId, assignmentId, input.reason, requestId, JSON.stringify({ ...input, status: "ACTIVE" })),
      ]);
      return json({
        data: { id: assignmentId, ...input, status: "ACTIVE", createdBy: identity.userId },
        requestId,
      }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) {
        return json({ error: "active_work_assignment_already_exists", requestId }, 409, requestId);
      }
      console.error("[opoint] work assignment creation failed", { type: error?.name || "Error" });
      return json({ error: "work_assignment_creation_failed", requestId }, 500, requestId);
    }
  }

  const assignmentId = decodeURIComponent(statusMatch[1]);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
  const normalized = normalizeAssignmentStatus(parsed.value);
  if (normalized.error) return json({ error: normalized.error, requestId }, 400, requestId);
  const next = normalized.value;
  const current = await env.DB.prepare(
    "SELECT id,status,staff_membership_id,branch_id,work_area,duty_role FROM staff_work_assignments WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(membership.company_id, assignmentId).first();
  if (!current) return json({ error: "work_assignment_not_found", requestId }, 404, requestId);
  if (current.status === next.status) return json({ data: current, idempotentReplay: true, requestId }, 200, requestId);
  if (current.status === "REVOKED") return json({ error: "revoked_assignment_is_terminal", requestId }, 409, requestId);
  if (next.status === "ACTIVE" && current.status !== "SUSPENDED") {
    return json({ error: "only_suspended_assignments_can_be_resumed", requestId }, 409, requestId);
  }
  if (next.status === "SUSPENDED" && current.status !== "ACTIVE") {
    return json({ error: "only_active_assignments_can_be_suspended", requestId }, 409, requestId);
  }
  const eventType = next.status === "ACTIVE" ? "RESUMED" : next.status;
  try {
    const changed = await env.DB.batch([
      env.DB.prepare(
        "UPDATE staff_work_assignments SET status=?1,updated_at=CURRENT_TIMESTAMP,suspended_by=CASE WHEN ?1='SUSPENDED' THEN ?2 ELSE NULL END,suspended_at=CASE WHEN ?1='SUSPENDED' THEN CURRENT_TIMESTAMP ELSE NULL END,revoked_by=CASE WHEN ?1='REVOKED' THEN ?2 ELSE NULL END,revoked_at=CASE WHEN ?1='REVOKED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE company_id=?3 AND id=?4 AND status=?5"
      ).bind(next.status, identity.userId, membership.company_id, assignmentId, current.status),
      env.DB.prepare(
        "INSERT INTO staff_work_assignment_events (id,company_id,assignment_id,event_type,previous_status,new_status,actor_id,reason) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE changes()=1"
      ).bind(crypto.randomUUID(), membership.company_id, assignmentId, eventType, current.status, next.status, identity.userId, next.reason),
      env.DB.prepare(
        "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) SELECT ?1,?2,?3,?4,'STAFF_WORK_ASSIGNMENT',?5,?6,?7,?8,?9 WHERE changes()=1"
      ).bind(crypto.randomUUID(), membership.company_id, identity.userId, `STAFF_WORK_ASSIGNMENT_${eventType}`, assignmentId, next.reason, requestId, JSON.stringify(current), JSON.stringify({ ...current, status: next.status })),
    ]);
    if (Number(changed?.[0]?.meta?.changes || 0) !== 1) {
      return json({ error: "work_assignment_changed_retry", requestId }, 409, requestId);
    }
    return json({ data: { ...current, status: next.status }, requestId }, 200, requestId);
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed")) {
      return json({ error: "another_active_work_assignment_exists", requestId }, 409, requestId);
    }
    console.error("[opoint] work assignment status change failed", { type: error?.name || "Error" });
    return json({ error: "work_assignment_status_change_failed", requestId }, 500, requestId);
  }
}

async function audit(env, request, companyId, actorId, action, entityType, entityId, afterState) {
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  const ip = request.headers.get("cf-connecting-ip") || "";
  const agent = request.headers.get("user-agent") || "";
  const [ipHash, agentHash] = await Promise.all([sha256(ip), sha256(agent)]);
  await env.DB.prepare(
    "INSERT INTO audit_events (id, company_id, actor_id, action, entity_type, entity_id, reason, request_id, before_state_json, after_state_json, ip_hash, user_agent_hash) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,NULL,?8,?9,?10)"
  ).bind(crypto.randomUUID(), companyId, actorId, action, entityType, entityId, requestId, JSON.stringify(afterState), ipHash, agentHash).run();
}

async function createCompany(request, env, identity, body) {
  const displayName = normalizeCompanyName(body.displayName);
  const legalName = clean(body.legalName, 180) || null;
  const branchName = clean(body.branchName || "Main branch", 100) || "Main branch";
  const idempotencyKey = clean(request.headers.get("idempotency-key"), 128);
  if (displayName.length < 2) return json({ error: "company_name_required" }, 400);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json({ error: "idempotency_key_required" }, 400);
  const fingerprint = await sha256(JSON.stringify({ displayName, legalName, branchName }));
  const prior = await env.DB.prepare(
    "SELECT request_fingerprint, response_body_json FROM company_creation_requests WHERE identity_subject = ?1 AND idempotency_key = ?2 LIMIT 1"
  ).bind(identity.userId, idempotencyKey).first();
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) return json({ error: "idempotency_key_reused_with_different_request" }, 409);
    try { return json({ data: JSON.parse(prior.response_body_json), idempotentReplay: true }, 200); }
    catch { return json({ error: "idempotency_record_corrupt" }, 500); }
  }

  const companyId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const ownerMembershipId = crypto.randomUUID();
  const inventoryId = crypto.randomUUID();
  const cashAccountId = crypto.randomUUID();
  const slug = normalizeSlug(displayName) + "-" + companyId.slice(0, 6);
  const ownerName = clean(body.ownerName, 120) || identity.email?.split("@")[0] || "Owner";
  const accounts = [
    ["1000", "Cash on hand", "ASSET", "DEBIT"],
    ["1100", "Bank", "ASSET", "DEBIT"],
    ["1200", "Inventory", "ASSET", "DEBIT"],
    ["1300", "Accounts receivable", "ASSET", "DEBIT"],
    ["2000", "Tax payable", "LIABILITY", "CREDIT"],
    ["3000", "Owner equity", "EQUITY", "CREDIT"],
    ["4000", "Sales revenue", "INCOME", "CREDIT"],
    ["5000", "Cost of goods sold", "EXPENSE", "DEBIT"],
    ["5100", "Sales discounts", "EXPENSE", "DEBIT"],
  ];
  const ledgerIds = accounts.map(() => crypto.randomUUID());
  const cashLedgerId = ledgerIds[0];
  const responseData = {
    company: { id: companyId, slug, displayName, legalName, status: "SETUP", currency: "UGX", countryCode: "UG" },
    branch: { id: branchId, code: "MAIN", name: branchName },
    membership: { id: ownerMembershipId, role: "OWNER", status: "ACTIVE" },
  };
  const statements = [
    env.DB.prepare("INSERT INTO companies (id,slug,display_name,legal_name,country_code,default_currency,timezone,status) VALUES (?1,?2,?3,?4,'UG','UGX','Africa/Kampala','SETUP')").bind(companyId, slug, displayName, legalName),
    env.DB.prepare("INSERT INTO branches (id,company_id,branch_code,name,country_code,timezone,status) VALUES (?1,?2,'MAIN',?3,'UG','Africa/Kampala','ACTIVE')").bind(branchId, companyId, branchName),
    env.DB.prepare("INSERT INTO staff_memberships (id,company_id,branch_id,identity_subject,display_name,email,role_key,status,created_by) VALUES (?1,?2,?3,?4,?5,?6,'OWNER','ACTIVE',?4)").bind(ownerMembershipId, companyId, branchId, identity.userId, ownerName, identity.email),
    env.DB.prepare("INSERT INTO inventory_locations (id,company_id,branch_id,code,name,status) VALUES (?1,?2,?3,'MAIN','Main stock location','ACTIVE')").bind(inventoryId, companyId, branchId),
    ...accounts.map((account, index) => env.DB.prepare("INSERT INTO ledger_accounts (id,company_id,account_code,name,account_type,normal_balance,is_system,status) VALUES (?1,?2,?3,?4,?5,?6,1,'ACTIVE')").bind(ledgerIds[index], companyId, account[0], account[1], account[2], account[3])),
    env.DB.prepare("INSERT INTO cash_accounts (id,company_id,branch_id,ledger_account_id,account_type,provider_code,account_code,display_name,currency,status) VALUES (?1,?2,?3,?4,'CASH_DRAWER',NULL,'CASH-MAIN','Main cash drawer','UGX','ACTIVE')").bind(cashAccountId, companyId, branchId, cashLedgerId),
    env.DB.prepare("INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,request_id,after_state_json) VALUES (?1,?2,?3,'COMPANY_CREATED','COMPANY',?2,?4,?5)").bind(crypto.randomUUID(), companyId, identity.userId, request.headers.get("cf-ray") || crypto.randomUUID(), JSON.stringify({ slug, branchId, ownerMembershipId })),
    env.DB.prepare("INSERT INTO company_creation_requests (id,identity_subject,idempotency_key,request_fingerprint,company_id,response_body_json) VALUES (?1,?2,?3,?4,?5,?6)").bind(crypto.randomUUID(), identity.userId, idempotencyKey, fingerprint, companyId, JSON.stringify(responseData)),
  ];
  try {
    await env.DB.batch(statements);
    return json({ data: responseData }, 201);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("UNIQUE constraint failed")) {
      const duplicate = await env.DB.prepare(
        "SELECT request_fingerprint, response_body_json FROM company_creation_requests WHERE identity_subject = ?1 AND idempotency_key = ?2 LIMIT 1"
      ).bind(identity.userId, idempotencyKey).first();
      if (duplicate?.request_fingerprint === fingerprint) {
        return json({ data: JSON.parse(duplicate.response_body_json), idempotentReplay: true }, 200);
      }
      return json({ error: "company_conflict_or_duplicate_request" }, 409);
    }
    console.error("[opoint] company creation failed", { type: error?.name || "Error" });
    return json({ error: "company_creation_failed" }, 500);
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();

  if (request.method === "GET" && url.pathname === "/health") {
    try {
      const [objects, migrations] = await Promise.all([
        env.DB.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','trigger','view') AND name NOT LIKE 'sqlite_%'").all(),
        env.DB.prepare("SELECT version FROM opoint_schema_migrations ORDER BY version").all(),
      ]);
      const names = new Set((objects.results || []).map(row => row.name));
      const migrationNames = new Set((migrations.results || []).map(row => row.version));
      const missingTables = REQUIRED_TABLES.filter(name => !names.has(name));
      const missingGuards = REQUIRED_GUARDS.filter(name => !names.has(name));
      const requiredMigrations = ["0001_opoint_core", "0002_operational_hardening", "0003_financial_integrity_guards", "0004_staff_work_assignments"];
      const missingMigrations = requiredMigrations.filter(name => !migrationNames.has(name));
      const ready = missingTables.length === 0 && missingGuards.length === 0 && missingMigrations.length === 0;
      return json({ service: "opoint-api-staging", status: ready ? "ready" : "schema_not_ready", schemaReady: ready, requestId }, ready ? 200 : 503, requestId);
    } catch {
      return json({ service: "opoint-api-staging", status: "database_unavailable", requestId }, 503, requestId);
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return json({
      product: "Opoint",
      paymentsEnabled: false,
      providerExecutionEnabled: false,
      aiAssistantEnabled: false,
      salesPostingEnabled: false,
      journalPostingEnabled: false,
      cashMovementEnabled: false,
      agencyOperationsEnabled: false,
      billPaymentsEnabled: false,
      airtimeAndDataEnabled: false,
      efrisSubmissionEnabled: false,
      notice: "Financial provider execution remains disabled pending security, provider and compliance release gates.",
      requestId,
    }, 200, requestId);
  }

  if (request.method === "OPTIONS") return json({ error: "method_not_allowed", requestId }, 405, requestId);

  const verified = await verifyIdentity(request, env);
  if (verified.response) return verified.response;
  const identity = verified.identity;

  if (request.method === "GET" && url.pathname === "/v1/me") {
    const memberships = await companyMemberships(env, identity.userId);
    return json({ data: { userId: identity.userId, email: identity.email, memberships }, requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/me/work-assignments") {
    const rows = await env.DB.prepare(
      "SELECT a.id,a.company_id,c.display_name AS company_name,a.branch_id,b.name AS branch_name,a.work_area,a.duty_role,a.status,a.created_at,a.updated_at FROM staff_work_assignments a JOIN staff_memberships sm ON sm.company_id=a.company_id AND sm.id=a.staff_membership_id JOIN companies c ON c.id=a.company_id JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE sm.identity_subject=?1 AND sm.status='ACTIVE' AND a.status='ACTIVE' AND b.status='ACTIVE' ORDER BY c.display_name,b.name,a.work_area LIMIT 100"
    ).bind(identity.userId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/v1/companies") {
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
    return createCompany(request, env, identity, parsed.value);
  }

  const companyId = clean(request.headers.get("x-company-id") || url.searchParams.get("companyId"), 80);
  const membership = await requireMembership(env, identity.userId, companyId);
  if (!membership) return json({ error: "company_access_denied", requestId }, 403, requestId);
  const assignmentResponse = await handleWorkAssignmentRoutes(request, env, identity, membership, url, requestId);
  if (assignmentResponse) return assignmentResponse;

  const privileged = canManageWorkAssignments(membership.role_key);
  const requestedBranchId = clean(request.headers.get("x-branch-id") || url.searchParams.get("branchId"), 80) || null;
  if (membership.branch_id && requestedBranchId && membership.branch_id !== requestedBranchId) {
    return json({ error: "branch_access_denied", requestId }, 403, requestId);
  }
  const scopedBranchId = membership.branch_id || requestedBranchId;
  if (requestedBranchId) {
    const branch = await env.DB.prepare(
      "SELECT id FROM branches WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
    ).bind(companyId, requestedBranchId).first();
    if (!branch) return json({ error: "active_branch_required", requestId }, 403, requestId);
  }
  const requireArea = async workArea => {
    const result = await requireWorkAreaAssignment(env, membership, scopedBranchId, workArea);
    return result.ok ? result : { ...result, response: json({ error: result.error, requestId }, result.status, requestId) };
  };

  const cashAreaMatch = url.pathname.match(/^\/v1\/cash\/accounts\/([A-Za-z0-9._:-]{1,80})\/work-area$/);
  if (request.method === "POST" && cashAreaMatch) {
    if (!privileged) return json({ error: "owner_or_admin_required", requestId }, 403, requestId);
    const accountId = decodeURIComponent(cashAreaMatch[1]);
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
    const requestedWorkArea = clean(parsed.value.workArea, 24).toUpperCase();
    const reason = clean(parsed.value.reason, 300);
    if (!WORK_AREAS.includes(requestedWorkArea)) return json({ error: "invalid_work_area", requestId }, 400, requestId);
    if (reason.length < 4) return json({ error: "reason_required", requestId }, 400, requestId);
    const account = await env.DB.prepare(
      "SELECT id,branch_id,account_type,provider_code,work_area FROM cash_accounts WHERE company_id=?1 AND id=?2 LIMIT 1"
    ).bind(companyId, accountId).first();
    if (!account) return json({ error: "cash_account_not_found", requestId }, 404, requestId);
    if (account.work_area === requestedWorkArea) {
      return json({ data: account, idempotentReplay: true, requestId }, 200, requestId);
    }
    const providerFloat = ["MOBILE_MONEY","PROVIDER_FLOAT"].includes(account.account_type)
      || ["MTN_MOMO","AIRTEL_MONEY"].includes(account.provider_code);
    if (providerFloat && requestedWorkArea !== "MOBILE_MONEY") {
      return json({ error: "provider_float_must_remain_mobile_money", requestId }, 409, requestId);
    }
    const changed = await env.DB.batch([
      env.DB.prepare(
        "UPDATE cash_accounts SET work_area=?1,updated_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND work_area=?4"
      ).bind(requestedWorkArea, companyId, accountId, account.work_area),
      env.DB.prepare(
        "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) SELECT ?1,?2,?3,'CASH_ACCOUNT_WORK_AREA_CHANGED','CASH_ACCOUNT',?4,?5,?6,?7,?8 WHERE changes()=1"
      ).bind(crypto.randomUUID(), companyId, identity.userId, accountId, reason, requestId, JSON.stringify(account), JSON.stringify({ ...account, work_area: requestedWorkArea })),
    ]);
    if (Number(changed?.[0]?.meta?.changes || 0) !== 1) {
      return json({ error: "cash_account_changed_retry", requestId }, 409, requestId);
    }
    return json({
      data: { ...account, work_area: requestedWorkArea },
      notice: "Work-area classification changed; no balance or ledger entry was altered.",
      requestId,
    }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/products") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    const search = clean(url.searchParams.get("q"), 80);
    const like = "%" + search.replace(/[%_\\]/g, "") + "%";
    const result = await env.DB.prepare(
      "SELECT id,sku,barcode,name,description,unit_of_measure,cost_amount,selling_amount,currency,track_stock,reorder_level,status,created_at,updated_at FROM products WHERE company_id = ?1 AND (?2 = '%%' OR name LIKE ?2 OR sku LIKE ?2 OR barcode LIKE ?2) ORDER BY name LIMIT 100"
    ).bind(companyId, search ? like : "%%").all();
    const canSeeCost = ["OWNER","ADMIN","MANAGER","ACCOUNTANT","AUDITOR"].includes(membership.role_key);
    const data = (result.results || []).map(row => ({ ...row, cost_amount: canSeeCost ? row.cost_amount : null }));
    return json({ data, requestId }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/v1/products") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    if (!["OWNER", "ADMIN", "MANAGER"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    if (!privileged && !["SUPERVISOR","APPROVER"].includes(area.assignment?.duty_role)) {
      return json({ error: "work_area_duty_role_insufficient", requestId }, 403, requestId);
    }
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
    const normalized = parseProductInput(parsed.value);
    if (normalized.error) return json({ error: normalized.error, requestId }, 400, requestId);
    const input = normalized.value;
    const productId = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO products (id,company_id,sku,name,unit_of_measure,cost_amount,selling_amount,currency,track_stock,status) VALUES (?1,?2,?3,?4,?5,?6,?7,'UGX',1,'ACTIVE')").bind(productId, companyId, input.sku, input.name, input.unitOfMeasure, input.costAmount, input.sellingAmount),
        env.DB.prepare("INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,request_id,after_state_json) VALUES (?1,?2,?3,'PRODUCT_CREATED','PRODUCT',?4,?5,?6)").bind(crypto.randomUUID(), companyId, identity.userId, productId, requestId, JSON.stringify({ sku: input.sku, name: input.name, sellingAmount: input.sellingAmount })),
      ]);
      return json({ data: { id: productId, ...input, currency: "UGX", status: "ACTIVE" }, requestId }, 201, requestId);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return json({ error: "product_sku_already_exists", requestId }, 409, requestId);
      console.error("[opoint] product creation failed", { type: error?.name || "Error" });
      return json({ error: "product_creation_failed", requestId }, 500, requestId);
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/overview") {
    if (!privileged) return json({ error: "owner_or_admin_required", requestId }, 403, requestId);
    const [products, sales] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active FROM products WHERE company_id=?1").bind(companyId).first(),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END) AS completed_amount FROM sales WHERE company_id=?1").bind(companyId).first(),
    ]);
    return json({ data: { products: { total: products?.total || 0, active: products?.active || 0 }, sales: { total: sales?.total || 0, completedAmountUGX: sales?.completed_amount || 0 } }, requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/customers") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    const search = clean(url.searchParams.get("q"), 80);
    const like = "%" + search.replace(/[%_\\]/g, "") + "%";
    const rows = await env.DB.prepare(
      "SELECT id,customer_ref,display_name,phone_e164,email,tax_identifier,status,created_at,updated_at FROM customers WHERE company_id=?1 AND status!='ARCHIVED' AND (?2='%%' OR display_name LIKE ?2 OR customer_ref LIKE ?2 OR phone_e164 LIKE ?2) ORDER BY display_name LIMIT 100"
    ).bind(companyId, search ? like : "%%").all();
    const canSeePersonalData = ["OWNER","ADMIN","ACCOUNTANT","AUDITOR"].includes(membership.role_key);
    const data = (rows.results || []).map(({ phone_e164, email, tax_identifier, ...row }) => ({
      ...row,
      phone: canSeePersonalData ? phone_e164 : maskPhone(phone_e164),
      email: canSeePersonalData ? email : maskEmail(email),
      taxIdentifier: canSeePersonalData ? tax_identifier : null,
    }));
    return json({ data, requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/suppliers") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    if (!["OWNER","ADMIN","MANAGER","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const search = clean(url.searchParams.get("q"), 80);
    const like = "%" + search.replace(/[%_\\]/g, "") + "%";
    const rows = await env.DB.prepare(
      "SELECT id,supplier_ref,display_name,phone_e164,email,status,created_at,updated_at FROM suppliers WHERE company_id=?1 AND status!='ARCHIVED' AND (?2='%%' OR display_name LIKE ?2 OR supplier_ref LIKE ?2 OR phone_e164 LIKE ?2) ORDER BY display_name LIMIT 100"
    ).bind(companyId, search ? like : "%%").all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/categories") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    const rows = await env.DB.prepare(
      "SELECT id,name,parent_id,created_at FROM product_categories WHERE company_id=?1 ORDER BY name LIMIT 200"
    ).bind(companyId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/stock") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    const rows = await env.DB.prepare(
      "SELECT p.id AS product_id,p.sku,p.name,p.unit_of_measure,p.reorder_level,p.status AS product_status,l.id AS location_id,l.code AS location_code,l.name AS location_name,COALESCE(SUM(sm.quantity_delta),0) AS quantity_on_hand FROM products p JOIN inventory_locations l ON l.company_id=p.company_id LEFT JOIN stock_movements sm ON sm.company_id=p.company_id AND sm.product_id=p.id AND sm.location_id=l.id WHERE p.company_id=?1 AND (?2 IS NULL OR l.branch_id=?2) GROUP BY p.id,l.id ORDER BY p.name,l.name LIMIT 500"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/sales") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    const rows = await env.DB.prepare(
      "SELECT s.id,s.receipt_number,s.status,s.subtotal_amount,s.discount_amount,s.tax_amount,s.total_amount,s.cost_amount,s.created_at,s.completed_at,c.display_name AS customer_name FROM sales s LEFT JOIN customers c ON c.company_id=s.company_id AND c.id=s.customer_id WHERE s.company_id=?1 AND (?2 IS NULL OR s.branch_id=?2) ORDER BY s.created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/cash/accounts") {
    const requestedWorkArea = clean(url.searchParams.get("workArea"), 24).toUpperCase() || null;
    if (!privileged && !["RETAIL","MOBILE_MONEY"].includes(requestedWorkArea)) {
      return json({ error: "work_area_required", requestId }, 400, requestId);
    }
    if (requestedWorkArea && !["RETAIL","MOBILE_MONEY"].includes(requestedWorkArea)) {
      return json({ error: "invalid_work_area", requestId }, 400, requestId);
    }
    if (requestedWorkArea) {
      const area = await requireArea(requestedWorkArea);
      if (area.response) return area.response;
    }
    const rows = await env.DB.prepare(
      "SELECT a.id,a.branch_id,b.name AS branch_name,a.account_type,a.provider_code,a.account_code,a.display_name,a.currency,a.status,a.work_area FROM cash_accounts a JOIN branches b ON b.company_id=a.company_id AND b.id=a.branch_id WHERE a.company_id=?1 AND (?2 IS NULL OR a.branch_id=?2) AND (?3 IS NULL OR a.work_area=?3) ORDER BY b.name,a.display_name"
    ).bind(companyId, scopedBranchId, requestedWorkArea).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/cash/sessions") {
    const requestedWorkArea = clean(url.searchParams.get("workArea"), 24).toUpperCase() || null;
    if (!privileged && !["RETAIL","MOBILE_MONEY"].includes(requestedWorkArea)) {
      return json({ error: "work_area_required", requestId }, 400, requestId);
    }
    if (requestedWorkArea && !["RETAIL","MOBILE_MONEY"].includes(requestedWorkArea)) {
      return json({ error: "invalid_work_area", requestId }, 400, requestId);
    }
    if (requestedWorkArea) {
      const area = await requireArea(requestedWorkArea);
      if (area.response) return area.response;
    }
    const rows = await env.DB.prepare(
      "SELECT s.id,s.branch_id,b.name AS branch_name,s.cash_account_id,a.display_name AS cash_account_name,a.work_area,s.opened_by,s.closed_by,s.opening_amount,s.expected_closing_amount,s.counted_closing_amount,s.difference_amount,s.status,s.opened_at,s.closed_at FROM cash_sessions s JOIN cash_accounts a ON a.company_id=s.company_id AND a.id=s.cash_account_id JOIN branches b ON b.company_id=s.company_id AND b.id=s.branch_id WHERE s.company_id=?1 AND (?2 IS NULL OR s.branch_id=?2) AND (?3 IS NULL OR a.work_area=?3) ORDER BY s.opened_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId, requestedWorkArea).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/purchases") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    if (!["OWNER","ADMIN","MANAGER","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const rows = await env.DB.prepare(
      "SELECT p.id,p.branch_id,p.order_number,p.status,p.currency,p.subtotal_amount,p.tax_amount,p.total_amount,p.created_at,s.display_name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.company_id=p.company_id AND s.id=p.supplier_id WHERE p.company_id=?1 AND (?2 IS NULL OR p.branch_id=?2) ORDER BY p.created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/expenses") {
    const area = await requireArea("RETAIL");
    if (area.response) return area.response;
    if (!["OWNER","ADMIN","MANAGER","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const rows = await env.DB.prepare(
      "SELECT id,branch_id,expense_reference,category_code,description,amount,currency,status,recorded_by,approved_by,created_at FROM business_expenses WHERE company_id=?1 AND (?2 IS NULL OR branch_id=?2) ORDER BY created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/reconciliation") {
    if (!["OWNER","ADMIN","MANAGER","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    if (!privileged && !["ACCOUNTANT","AUDITOR"].includes(membership.role_key) && !scopedBranchId) {
      return json({ error: "branch_selection_required", requestId }, 400, requestId);
    }
    const rows = await env.DB.prepare(
      "SELECT r.id,r.branch_id,r.reconciliation_type,r.provider_code,r.business_date,r.expected_amount,r.counted_amount,r.difference_amount,r.status,r.notes,r.prepared_by,r.approved_by,r.created_at,r.updated_at,(SELECT COUNT(*) FROM reconciliation_items i WHERE i.company_id=r.company_id AND i.reconciliation_session_id=r.id) AS item_count FROM reconciliation_sessions r WHERE r.company_id=?1 AND (?2 IS NULL OR r.branch_id=?2) ORDER BY r.business_date DESC,r.created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/ledger/entries") {
    if (!["OWNER","ADMIN","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const rows = await env.DB.prepare(
      "SELECT e.id,e.entry_number,e.source_type,e.source_id,e.status,e.currency,e.description,e.created_by,e.posted_by,e.created_at,e.posted_at,COALESCE(SUM(l.debit_amount),0) AS debit_total,COALESCE(SUM(l.credit_amount),0) AS credit_total FROM journal_entries e LEFT JOIN journal_lines l ON l.company_id=e.company_id AND l.journal_entry_id=e.id WHERE e.company_id=?1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100"
    ).bind(companyId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/payment-intents") {
    const area = await requireArea("MOBILE_MONEY");
    if (area.response) return area.response;
    if (!["OWNER","ADMIN","ACCOUNTANT","AUDITOR","AGENT"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const rows = await env.DB.prepare(
      "SELECT id,branch_id,source_type,source_id,operation_type,provider_code,provider_reference,external_reference,status,amount,fee_amount,commission_amount,currency,failure_code,created_at,updated_at,resolved_at FROM payment_intents WHERE company_id=?1 AND (?2 IS NULL OR branch_id=?2) ORDER BY created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/agency/operations") {
    const area = await requireArea("MOBILE_MONEY");
    if (area.response) return area.response;
    if (!["OWNER","ADMIN","MANAGER","AGENT","ACCOUNTANT","AUDITOR"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
    const rows = await env.DB.prepare(
      "SELECT id,branch_id,provider_code,operation_type,status,amount,fee_amount,commission_amount,reference,created_by,created_at,completed_at FROM agency_operations WHERE company_id=?1 AND (?2 IS NULL OR branch_id=?2) ORDER BY created_at DESC LIMIT 100"
    ).bind(companyId, scopedBranchId).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/billers") {
    const rows = await env.DB.prepare(
      "SELECT id,provider_code,biller_code,biller_name,category,status,updated_at FROM biller_catalog WHERE status='ACTIVE' ORDER BY category,biller_name LIMIT 200"
    ).all();
    return json({ data: rows.results || [], requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/integrations") {
    if (!privileged) return json({ error: "owner_or_admin_required", requestId }, 403, requestId);
    const result = await env.DB.prepare(
      "SELECT provider_code,environment,status,last_health_check_at,last_error_code,updated_at FROM integration_status WHERE company_id=?1 ORDER BY provider_code,environment"
    ).bind(companyId).all();
    return json({ data: result.results || [], requestId }, 200, requestId);
  }

  return json({ error: "not_found", requestId }, 404, requestId);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
      console.error("[opoint] unhandled request error", { type: error?.name || "Error" });
      return json({ error: "internal_error", requestId }, 500, requestId);
    }
  },
};

export { REQUIRED_TABLES, REQUIRED_GUARDS };

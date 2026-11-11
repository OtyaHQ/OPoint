const REQUIRED_TABLES = [
  "companies", "branches", "staff_memberships", "company_creation_requests",
  "inventory_locations", "ledger_accounts", "cash_accounts", "products",
  "sales", "journal_entries", "journal_lines", "payment_intents",
  "opoint_schema_migrations", "audit_events", "integration_status",
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
      const requiredMigrations = ["0001_opoint_core", "0002_operational_hardening", "0003_financial_integrity_guards"];
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

  if (request.method === "POST" && url.pathname === "/v1/companies") {
    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, requestId }, parsed.status, requestId);
    return createCompany(request, env, identity, parsed.value);
  }

  const companyId = clean(request.headers.get("x-company-id") || url.searchParams.get("companyId"), 80);
  const membership = await requireMembership(env, identity.userId, companyId);
  if (!membership) return json({ error: "company_access_denied", requestId }, 403, requestId);

  if (request.method === "GET" && url.pathname === "/v1/products") {
    const search = clean(url.searchParams.get("q"), 80);
    const like = "%" + search.replace(/[%_\\]/g, "") + "%";
    const result = await env.DB.prepare(
      "SELECT id,sku,barcode,name,description,unit_of_measure,cost_amount,selling_amount,currency,track_stock,reorder_level,status,created_at,updated_at FROM products WHERE company_id = ?1 AND (?2 = '%%' OR name LIKE ?2 OR sku LIKE ?2 OR barcode LIKE ?2) ORDER BY name LIMIT 100"
    ).bind(companyId, search ? like : "%%").all();
    return json({ data: result.results || [], requestId }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/v1/products") {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(membership.role_key)) return json({ error: "forbidden", requestId }, 403, requestId);
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
    const [products, sales] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active FROM products WHERE company_id=?1").bind(companyId).first(),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END) AS completed_amount FROM sales WHERE company_id=?1").bind(companyId).first(),
    ]);
    return json({ data: { products: { total: products?.total || 0, active: products?.active || 0 }, sales: { total: sales?.total || 0, completedAmountUGX: sales?.completed_amount || 0 } }, requestId }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/v1/integrations") {
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

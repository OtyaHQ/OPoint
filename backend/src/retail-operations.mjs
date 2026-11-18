import { calculateSaleAmounts } from "./sales.mjs";
import { validateJournalLines } from "./ledger.mjs";
import { canPerformWorkAreaWrite } from "./work-assignments.mjs";

const MAX_UGX = 1_000_000_000_000;
const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
  : "";

function json(body, status = 200, requestId = undefined) {
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

async function readJson(request, maxBytes = 16_384) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "request_too_large", status: 413 };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_json_object", status: 400 };
    return { value };
  } catch {
    return { error: "invalid_json", status: 400 };
  }
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function idempotencyKey(request) {
  const key = clean(request.headers.get("idempotency-key"), 80);
  return /^[A-Za-z0-9._:-]{8,80}$/.test(key) ? key : "";
}

async function replayOrConflict(db, companyId, scope, key, fingerprint, requestId) {
  const prior = await db.prepare(
    "SELECT request_fingerprint,response_status,response_body_json FROM idempotency_records WHERE company_id=?1 AND operation_scope=?2 AND idempotency_key=?3 LIMIT 1"
  ).bind(companyId, scope, key).first();
  if (!prior) return { replay: false };
  if (prior.request_fingerprint !== fingerprint) {
    return { response: json({ error: "idempotency_key_payload_conflict", requestId }, 409, requestId) };
  }
  try {
    const body = JSON.parse(prior.response_body_json);
    return { response: json({ ...body, idempotentReplay: true }, Number(prior.response_status) || 200, requestId) };
  } catch {
    return { response: json({ error: "idempotency_record_corrupt", requestId }, 500, requestId) };
  }
}

function idempotencyStatement(db, { companyId, scope, key, fingerprint, status, body, resourceType, resourceId }) {
  return db.prepare(
    "INSERT INTO idempotency_records (id,company_id,operation_scope,idempotency_key,request_fingerprint,response_status,response_body_json,resource_type,resource_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
  ).bind(crypto.randomUUID(), companyId, scope, key, fingerprint, status, JSON.stringify(body), resourceType, resourceId);
}

function auditStatement(db, { companyId, actorId, action, entityType, entityId, reason, requestId, before, after }) {
  return db.prepare(
    "INSERT INTO audit_events (id,company_id,actor_id,action,entity_type,entity_id,reason,request_id,before_state_json,after_state_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
  ).bind(
    crypto.randomUUID(), companyId, actorId, action, entityType, entityId,
    reason ?? null, requestId, before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  );
}

function retailPermission(area, privileged, allowedDutyRoles = ["OPERATOR", "SUPERVISOR", "APPROVER"]) {
  return privileged || canPerformWorkAreaWrite(area.assignment, allowedDutyRoles);
}

export function validateRetailSaleRequest(body) {
  if (clean(body?.paymentMethod, 24).toUpperCase() !== "CASH") {
    return { error: "payment_method_not_enabled", status: 422 };
  }
  const cashSessionId = clean(body?.cashSessionId, 80);
  if (!cashSessionId) return { error: "cash_session_required", status: 400 };
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 40) {
    return { error: "sale_requires_1_to_40_lines", status: 400 };
  }
  const seen = new Set();
  const items = [];
  for (const line of body.items) {
    const productId = clean(line?.productId, 80);
    const quantity = line?.quantity;
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000 || seen.has(productId)) {
      return { error: "invalid_sale_items", status: 400 };
    }
    seen.add(productId);
    items.push({ productId, quantity });
  }
  const customerId = clean(body?.customerId, 80) || null;
  return { value: { cashSessionId, items, customerId } };
}

export function calculateCashDifference(expected, counted) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_UGX
    || !Number.isSafeInteger(counted) || counted < 0 || counted > MAX_UGX) {
    return { ok: false, error: "cash_amounts_must_be_whole_ugx" };
  }
  return { ok: true, difference: counted - expected };
}

async function requireRetail(request, membership, context, allowedRoles, allowedDutyRoles = ["OPERATOR", "SUPERVISOR", "APPROVER"]) {
  if (!allowedRoles.includes(membership.role_key)) {
    return { response: json({ error: "retail_role_required", requestId: context.requestId }, 403, context.requestId) };
  }
  if (!context.scopedBranchId) {
    return { response: json({ error: "branch_selection_required", requestId: context.requestId }, 400, context.requestId) };
  }
  const area = await context.requireArea("RETAIL");
  if (area.response) return { response: area.response };
  if (!retailPermission(area, context.privileged, allowedDutyRoles)) {
    return { response: json({ error: "retail_duty_role_insufficient", requestId: context.requestId }, 403, context.requestId) };
  }
  return { area };
}

async function openCashSession(request, env, identity, membership, context) {
  const access = await requireRetail(request, membership, context, ["OWNER", "ADMIN", "MANAGER", "CASHIER"]);
  if (access.response) return access.response;
  const parsed = await readJson(request, 4096);
  if (parsed.error) return json({ error: parsed.error, requestId: context.requestId }, parsed.status, context.requestId);
  const accountId = clean(parsed.value.cashAccountId, 80);
  const openingAmount = parsed.value.openingAmount;
  const reason = clean(parsed.value.reason, 240) || "Cash session opened";
  if (!accountId || !Number.isSafeInteger(openingAmount) || openingAmount < 0 || openingAmount > MAX_UGX) {
    return json({ error: "invalid_cash_session_input", requestId: context.requestId }, 400, context.requestId);
  }
  const key = idempotencyKey(request);
  if (!key) return json({ error: "idempotency_key_required", requestId: context.requestId }, 400, context.requestId);
  const body = { cashAccountId: accountId, branchId: context.scopedBranchId, openingAmount, reason };
  const fingerprint = await sha256(JSON.stringify(body));
  const replay = await replayOrConflict(env.DB, context.companyId, "CASH_SESSION_OPEN", key, fingerprint, context.requestId);
  if (replay.response) return replay.response;

  const account = await env.DB.prepare(
    "SELECT id,branch_id,ledger_account_id,account_type,work_area,display_name,status FROM cash_accounts WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(context.companyId, accountId).first();
  if (!account || account.status !== "ACTIVE" || account.branch_id !== context.scopedBranchId
    || account.account_type !== "CASH_DRAWER" || account.work_area !== "RETAIL") {
    return json({ error: "active_retail_cash_drawer_required", requestId: context.requestId }, 409, context.requestId);
  }
  const unresolved = await env.DB.prepare(
    "SELECT id,status FROM cash_sessions WHERE company_id=?1 AND cash_account_id=?2 AND status IN ('OPEN','SUBMITTED','DISPUTED') LIMIT 1"
  ).bind(context.companyId, accountId).first();
  if (unresolved) return json({ error: "cash_drawer_has_unresolved_session", requestId: context.requestId }, 409, context.requestId);

  const sessionId = crypto.randomUUID();
  const resultBody = {
    data: {
      id: sessionId, branchId: context.scopedBranchId, cashAccountId: accountId,
      cashAccountName: account.display_name, openingAmount, expectedClosingAmount: openingAmount,
      currency: "UGX", status: "OPEN", openedBy: identity.userId,
    },
  };
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cash_sessions (id,company_id,branch_id,cash_account_id,opened_by,opening_amount,expected_closing_amount,status) VALUES (?1,?2,?3,?4,?5,?6,?6,'OPEN')"
      ).bind(sessionId, context.companyId, context.scopedBranchId, accountId, identity.userId, openingAmount),
      auditStatement(env.DB, {
        companyId: context.companyId, actorId: identity.userId, action: "CASH_SESSION_OPENED",
        entityType: "CASH_SESSION", entityId: sessionId, reason, requestId: context.requestId,
        before: null, after: resultBody.data,
      }),
      idempotencyStatement(env.DB, {
        companyId: context.companyId, scope: "CASH_SESSION_OPEN", key, fingerprint,
        status: 201, body: resultBody, resourceType: "CASH_SESSION", resourceId: sessionId,
      }),
    ]);
    return json(resultBody, 201, context.requestId);
  } catch (error) {
    const existing = await replayOrConflict(env.DB, context.companyId, "CASH_SESSION_OPEN", key, fingerprint, context.requestId);
    if (existing.response) return existing.response;
    const message = String(error?.message || "");
    if (message.includes("UNIQUE constraint failed")) {
      return json({ error: "cash_drawer_has_unresolved_session", requestId: context.requestId }, 409, context.requestId);
    }
    console.error("[opoint] cash session open failed", { type: error?.name || "Error" });
    return json({ error: "cash_session_open_failed", requestId: context.requestId }, 500, context.requestId);
  }
}

async function submitCashSession(request, env, identity, membership, context, sessionId) {
  const access = await requireRetail(request, membership, context, ["OWNER", "ADMIN", "MANAGER", "CASHIER"]);
  if (access.response) return access.response;
  const parsed = await readJson(request, 4096);
  if (parsed.error) return json({ error: parsed.error, requestId: context.requestId }, parsed.status, context.requestId);
  const countedAmount = parsed.value.countedClosingAmount;
  const reason = clean(parsed.value.reason, 240) || "Cash count submitted";
  if (!Number.isSafeInteger(countedAmount) || countedAmount < 0 || countedAmount > MAX_UGX) {
    return json({ error: "cash_amounts_must_be_whole_ugx", requestId: context.requestId }, 400, context.requestId);
  }
  const key = idempotencyKey(request);
  if (!key) return json({ error: "idempotency_key_required", requestId: context.requestId }, 400, context.requestId);
  const fingerprint = await sha256(JSON.stringify({ sessionId, countedAmount, reason }));
  const replay = await replayOrConflict(env.DB, context.companyId, "CASH_SESSION_SUBMIT:" + sessionId, key, fingerprint, context.requestId);
  if (replay.response) return replay.response;

  const session = await env.DB.prepare(
    "SELECT id,branch_id,cash_account_id,opened_by,expected_closing_amount,status FROM cash_sessions WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(context.companyId, sessionId).first();
  if (!session || session.branch_id !== context.scopedBranchId) return json({ error: "cash_session_not_found", requestId: context.requestId }, 404, context.requestId);
  if (session.opened_by !== identity.userId && !context.privileged) return json({ error: "cash_session_operator_mismatch", requestId: context.requestId }, 403, context.requestId);
  if (session.status !== "OPEN") return json({ error: "cash_session_not_open", requestId: context.requestId }, 409, context.requestId);
  const diff = calculateCashDifference(Number(session.expected_closing_amount), countedAmount);
  if (!diff.ok) return json({ error: diff.error, requestId: context.requestId }, 400, context.requestId);
  const resultBody = {
    data: {
      id: sessionId, status: "SUBMITTED", expectedClosingAmount: Number(session.expected_closing_amount),
      countedClosingAmount: countedAmount, differenceAmount: diff.difference, submittedBy: identity.userId,
    },
  };
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE cash_sessions SET status='SUBMITTED',counted_closing_amount=?1,difference_amount=?2,closed_by=?3 WHERE company_id=?4 AND id=?5 AND status='OPEN'"
      ).bind(countedAmount, diff.difference, identity.userId, context.companyId, sessionId),
      auditStatement(env.DB, {
        companyId: context.companyId, actorId: identity.userId, action: "CASH_SESSION_SUBMITTED",
        entityType: "CASH_SESSION", entityId: sessionId, reason, requestId: context.requestId,
        before: session, after: resultBody.data,
      }),
      idempotencyStatement(env.DB, {
        companyId: context.companyId, scope: "CASH_SESSION_SUBMIT:" + sessionId, key, fingerprint,
        status: 200, body: resultBody, resourceType: "CASH_SESSION", resourceId: sessionId,
      }),
    ]);
    return json(resultBody, 200, context.requestId);
  } catch {
    const existing = await replayOrConflict(env.DB, context.companyId, "CASH_SESSION_SUBMIT:" + sessionId, key, fingerprint, context.requestId);
    if (existing.response) return existing.response;
    return json({ error: "cash_session_submit_conflict", requestId: context.requestId }, 409, context.requestId);
  }
}

async function reviewCashSession(request, env, identity, membership, context, sessionId) {
  if (!["OWNER", "ADMIN", "MANAGER"].includes(membership.role_key)) {
    return json({ error: "cash_session_review_forbidden", requestId: context.requestId }, 403, context.requestId);
  }
  const access = await requireRetail(request, membership, context, ["OWNER", "ADMIN", "MANAGER"], ["SUPERVISOR", "APPROVER"]);
  if (access.response) return access.response;
  const parsed = await readJson(request, 4096);
  if (parsed.error) return json({ error: parsed.error, requestId: context.requestId }, parsed.status, context.requestId);
  const action = clean(parsed.value.action, 24).toLowerCase();
  const reason = clean(parsed.value.reason, 240);
  if (!["approve", "dispute", "resolve"].includes(action)) {
    return json({ error: "invalid_cash_session_review_action", requestId: context.requestId }, 400, context.requestId);
  }
  if (reason.length < 4) return json({ error: "review_reason_required", requestId: context.requestId }, 400, context.requestId);
  if (action === "resolve" && !context.privileged) {
    return json({ error: "owner_or_admin_required_to_resolve_dispute", requestId: context.requestId }, 403, context.requestId);
  }
  const key = idempotencyKey(request);
  if (!key) return json({ error: "idempotency_key_required", requestId: context.requestId }, 400, context.requestId);
  const fingerprint = await sha256(JSON.stringify({ sessionId, action, reason }));
  const scope = "CASH_SESSION_REVIEW:" + sessionId;
  const replay = await replayOrConflict(env.DB, context.companyId, scope, key, fingerprint, context.requestId);
  if (replay.response) return replay.response;

  const session = await env.DB.prepare(
    "SELECT id,branch_id,opened_by,expected_closing_amount,counted_closing_amount,difference_amount,status FROM cash_sessions WHERE company_id=?1 AND id=?2 LIMIT 1"
  ).bind(context.companyId, sessionId).first();
  if (!session || session.branch_id !== context.scopedBranchId) return json({ error: "cash_session_not_found", requestId: context.requestId }, 404, context.requestId);
  let nextStatus;
  if (action === "approve" && session.status === "SUBMITTED") {
    if (Number(session.difference_amount) !== 0) return json({ error: "cash_difference_requires_dispute", requestId: context.requestId }, 409, context.requestId);
    nextStatus = "CLOSED";
  } else if (action === "dispute" && session.status === "SUBMITTED") {
    nextStatus = "DISPUTED";
  } else if (action === "resolve" && session.status === "DISPUTED") {
    nextStatus = "CLOSED";
  } else {
    return json({ error: "cash_session_review_transition_invalid", requestId: context.requestId }, 409, context.requestId);
  }
  const resultBody = {
    data: {
      id: sessionId, status: nextStatus, expectedClosingAmount: Number(session.expected_closing_amount),
      countedClosingAmount: Number(session.counted_closing_amount), differenceAmount: Number(session.difference_amount),
    },
  };
  const update = nextStatus === "CLOSED"
    ? env.DB.prepare(
      "UPDATE cash_sessions SET status='CLOSED',closed_by=?1,closed_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND status=?4"
    ).bind(identity.userId, context.companyId, sessionId, session.status)
    : env.DB.prepare(
      "UPDATE cash_sessions SET status='DISPUTED' WHERE company_id=?1 AND id=?2 AND status='SUBMITTED'"
    ).bind(context.companyId, sessionId);
  try {
    await env.DB.batch([
      update,
      auditStatement(env.DB, {
        companyId: context.companyId, actorId: identity.userId, action: "CASH_SESSION_" + nextStatus,
        entityType: "CASH_SESSION", entityId: sessionId, reason, requestId: context.requestId,
        before: session, after: resultBody.data,
      }),
      idempotencyStatement(env.DB, {
        companyId: context.companyId, scope, key, fingerprint, status: 200,
        body: resultBody, resourceType: "CASH_SESSION", resourceId: sessionId,
      }),
    ]);
    return json(resultBody, 200, context.requestId);
  } catch {
    const existing = await replayOrConflict(env.DB, context.companyId, scope, key, fingerprint, context.requestId);
    if (existing.response) return existing.response;
    return json({ error: "cash_session_review_conflict", requestId: context.requestId }, 409, context.requestId);
  }
}

async function createCashSale(request, env, identity, membership, context) {
  const access = await requireRetail(request, membership, context, ["OWNER", "ADMIN", "MANAGER", "CASHIER"]);
  if (access.response) return access.response;
  const parsed = await readJson(request, 12_000);
  if (parsed.error) return json({ error: parsed.error, requestId: context.requestId }, parsed.status, context.requestId);
  const normalized = validateRetailSaleRequest(parsed.value);
  if (normalized.error) return json({ error: normalized.error, requestId: context.requestId }, normalized.status, context.requestId);
  const key = idempotencyKey(request);
  if (!key) return json({ error: "idempotency_key_required", requestId: context.requestId }, 400, context.requestId);
  const saleInput = {
    cashSessionId: normalized.value.cashSessionId,
    items: normalized.value.items,
    customerId: normalized.value.customerId,
    branchId: context.scopedBranchId,
    paymentMethod: "CASH",
  };
  const fingerprint = await sha256(JSON.stringify(saleInput));
  const replay = await replayOrConflict(env.DB, context.companyId, "RETAIL_CASH_SALE", key, fingerprint, context.requestId);
  if (replay.response) return replay.response;

  const session = await env.DB.prepare(
    "SELECT cs.id,cs.branch_id,cs.opened_by,cs.expected_closing_amount,cs.status,ca.id AS cash_account_id,ca.ledger_account_id,ca.work_area,ca.account_type FROM cash_sessions cs JOIN cash_accounts ca ON ca.company_id=cs.company_id AND ca.id=cs.cash_account_id WHERE cs.company_id=?1 AND cs.id=?2 LIMIT 1"
  ).bind(context.companyId, saleInput.cashSessionId).first();
  if (!session || session.branch_id !== context.scopedBranchId) return json({ error: "cash_session_not_found", requestId: context.requestId }, 404, context.requestId);
  if (session.status !== "OPEN" || session.work_area !== "RETAIL" || session.account_type !== "CASH_DRAWER") {
    return json({ error: "open_retail_cash_session_required", requestId: context.requestId }, 409, context.requestId);
  }
  if (session.opened_by !== identity.userId && !context.privileged) {
    return json({ error: "cash_session_operator_mismatch", requestId: context.requestId }, 403, context.requestId);
  }

  if (saleInput.customerId) {
    const customer = await env.DB.prepare(
      "SELECT id FROM customers WHERE company_id=?1 AND id=?2 AND status='ACTIVE' LIMIT 1"
    ).bind(context.companyId, saleInput.customerId).first();
    if (!customer) return json({ error: "active_customer_required", requestId: context.requestId }, 404, context.requestId);
  }

  const productIds = saleInput.items.map(item => item.productId);
  const placeholders = productIds.map((_, index) => "?"+(index+2)).join(",");
  const productResult = await env.DB.prepare(
    "SELECT id,sku,name,cost_amount,selling_amount,track_stock,status FROM products WHERE company_id=?1 AND id IN ("+placeholders+")"
  ).bind(context.companyId, ...productIds).all();
  const products = productResult.results || [];
  const productMap = new Map(products.map(product => [product.id, product]));
  if (productMap.size !== productIds.length || products.some(product => product.status !== "ACTIVE")) {
    return json({ error: "active_products_required", requestId: context.requestId }, 409, context.requestId);
  }

  const location = await env.DB.prepare(
    "SELECT id FROM inventory_locations WHERE company_id=?1 AND branch_id=?2 AND code='MAIN' AND status='ACTIVE' LIMIT 1"
  ).bind(context.companyId, context.scopedBranchId).first();
  if (!location) return json({ error: "active_inventory_location_required", requestId: context.requestId }, 409, context.requestId);

  const stockResult = await env.DB.prepare(
    "SELECT product_id,COALESCE(SUM(quantity_delta),0) AS quantity_on_hand FROM stock_movements WHERE company_id=?1 AND location_id=?2 AND product_id IN ("+productIds.map((_,index)=>"?"+(index+3)).join(",")+") GROUP BY product_id"
  ).bind(context.companyId, location.id, ...productIds).all();
  const onHand = new Map((stockResult.results || []).map(row => [row.product_id, Number(row.quantity_on_hand)]));
  for (const item of saleInput.items) {
    const product = productMap.get(item.productId);
    const available = onHand.get(item.productId) || 0;
    if (Number(product.track_stock) === 1 && available < item.quantity) {
      return json({ error: "insufficient_stock", productId: item.productId, available, requested: item.quantity, requestId: context.requestId }, 409, context.requestId);
    }
  }

  const amounts = calculateSaleAmounts(saleInput.items.map(item => {
    const product = productMap.get(item.productId);
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPriceAmount: Number(product.selling_amount),
      unitCostAmount: Number(product.track_stock) === 1 ? Number(product.cost_amount) : 0,
      discountAmount: 0,
    };
  }), 0);
  if (!amounts.ok || amounts.value.totalAmount <= 0) {
    return json({ error: amounts.error || "sale_total_must_be_positive", requestId: context.requestId }, 400, context.requestId);
  }

  const chartResult = await env.DB.prepare(
    "SELECT id,account_code FROM ledger_accounts WHERE company_id=?1 AND status='ACTIVE' AND account_code IN ('1200','4000','5000')"
  ).bind(context.companyId).all();
  const chart = new Map((chartResult.results || []).map(row => [row.account_code, row.id]));
  const cashLedger = await env.DB.prepare(
    "SELECT id FROM ledger_accounts WHERE company_id=?1 AND id=?2 AND status='ACTIVE' AND currency='UGX' LIMIT 1"
  ).bind(context.companyId, session.ledger_account_id).first();
  if (!cashLedger || !chart.has("4000") || (amounts.value.costAmount > 0 && (!chart.has("1200") || !chart.has("5000")))) {
    return json({ error: "required_active_ledger_accounts_missing", requestId: context.requestId }, 409, context.requestId);
  }

  const journalLines = [
    { ledgerAccountId: cashLedger.id, debitAmount: amounts.value.totalAmount, creditAmount: 0, memo: "Cash received" },
    { ledgerAccountId: chart.get("4000"), debitAmount: 0, creditAmount: amounts.value.totalAmount, memo: "Retail sales revenue" },
  ];
  if (amounts.value.costAmount > 0) {
    journalLines.push(
      { ledgerAccountId: chart.get("5000"), debitAmount: amounts.value.costAmount, creditAmount: 0, memo: "Cost of goods sold" },
      { ledgerAccountId: chart.get("1200"), debitAmount: 0, creditAmount: amounts.value.costAmount, memo: "Inventory relieved at cost" },
    );
  }
  const validJournal = validateJournalLines(journalLines);
  if (!validJournal.ok) return json({ error: validJournal.error, requestId: context.requestId }, 400, context.requestId);

  const saleId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const journalId = crypto.randomUUID();
  const receiptDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const receiptNumber = "OTY-" + receiptDate + "-" + saleId.slice(0, 8).toUpperCase();
  const journalNumber = "JRN-" + journalId.slice(0, 12).toUpperCase();
  const resultBody = {
    data: {
      id: saleId, receiptNumber, status: "COMPLETED", currency: "UGX",
      subtotalAmount: amounts.value.subtotalAmount, discountAmount: 0, taxAmount: 0,
      totalAmount: amounts.value.totalAmount, costAmount: amounts.value.costAmount,
      cashSessionId: session.id,
    },
  };
  const statements = [
    env.DB.prepare(
      "INSERT INTO sales (id,company_id,branch_id,cash_session_id,receipt_number,customer_id,status,currency,subtotal_amount,discount_amount,tax_amount,total_amount,cost_amount,idempotency_key,actor_id,completed_at) VALUES (?1,?2,?3,?4,?5,?6,'COMPLETED','UGX',?7,0,0,?8,?9,?10,?11,CURRENT_TIMESTAMP)"
    ).bind(saleId, context.companyId, context.scopedBranchId, session.id, receiptNumber, saleInput.customerId, amounts.value.subtotalAmount, amounts.value.totalAmount, amounts.value.costAmount, key, identity.userId),
    ...amounts.value.lines.map(line => {
      const product = productMap.get(line.productId);
      return env.DB.prepare(
        "INSERT INTO sale_lines (id,company_id,sale_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_amount,unit_cost_amount,discount_amount,line_total_amount) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10)"
      ).bind(crypto.randomUUID(), context.companyId, saleId, line.productId, product.sku, product.name, line.quantity, line.unitPriceAmount, line.unitCostAmount, line.lineTotalAmount);
    }),
    env.DB.prepare(
      "INSERT INTO payment_intents (id,company_id,branch_id,source_type,source_id,operation_type,provider_code,status,amount,fee_amount,commission_amount,currency,idempotency_key,actor_id,resolved_at) VALUES (?1,?2,?3,'SALE',?4,'COLLECTION','CASH','SUCCEEDED',?5,0,0,'UGX',?6,?7,CURRENT_TIMESTAMP)"
    ).bind(paymentId, context.companyId, context.scopedBranchId, saleId, amounts.value.totalAmount, key + ":PAYMENT", identity.userId),
    env.DB.prepare(
      "INSERT INTO sale_payments (id,company_id,sale_id,payment_intent_id,allocated_amount) VALUES (?1,?2,?3,?4,?5)"
    ).bind(crypto.randomUUID(), context.companyId, saleId, paymentId, amounts.value.totalAmount),
    env.DB.prepare(
      "INSERT INTO journal_entries (id,company_id,entry_number,source_type,source_id,status,currency,description,idempotency_key,created_by) VALUES (?1,?2,?3,'RETAIL_SALE',?4,'DRAFT','UGX',?5,?6,?7)"
    ).bind(journalId, context.companyId, journalNumber, saleId, "Cash retail sale " + receiptNumber, key + ":JOURNAL", identity.userId),
    ...validJournal.value.lines.map((line, index) => env.DB.prepare(
      "INSERT INTO journal_lines (id,company_id,journal_entry_id,line_number,ledger_account_id,debit_amount,credit_amount,memo) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
    ).bind(crypto.randomUUID(), context.companyId, journalId, index + 1, line.ledgerAccountId, line.debitAmount, line.creditAmount, line.memo)),
    env.DB.prepare(
      "UPDATE journal_entries SET status='POSTED',posted_by=?1,posted_at=CURRENT_TIMESTAMP WHERE company_id=?2 AND id=?3 AND status='DRAFT'"
    ).bind(identity.userId, context.companyId, journalId),
  ];

  for (const line of amounts.value.lines) {
    const product = productMap.get(line.productId);
    if (Number(product.track_stock) !== 1) continue;
    const current = onHand.get(line.productId) || 0;
    const after = current - line.quantity;
    statements.push(env.DB.prepare(
      "INSERT INTO stock_movements (id,company_id,product_id,location_id,movement_type,quantity_delta,quantity_after,unit_cost_amount,reference_type,reference_id,idempotency_key,actor_id,reason) VALUES (?1,?2,?3,?4,'SALE',?5,?6,?7,'SALE',?8,?9,?10,?11)"
    ).bind(
      crypto.randomUUID(), context.companyId, line.productId, location.id, -line.quantity, after,
      line.unitCostAmount, saleId, "SALE:" + await sha256(key + "|" + line.productId), identity.userId,
      "Retail cash sale " + receiptNumber,
    ));
  }

  statements.push(
    env.DB.prepare(
      "UPDATE cash_sessions SET expected_closing_amount=COALESCE(expected_closing_amount,opening_amount)+?1 WHERE company_id=?2 AND id=?3 AND status='OPEN'"
    ).bind(amounts.value.totalAmount, context.companyId, session.id),
    auditStatement(env.DB, {
      companyId: context.companyId, actorId: identity.userId, action: "RETAIL_CASH_SALE_POSTED",
      entityType: "SALE", entityId: saleId, reason: "Cash sale posted against open retail cash session",
      requestId: context.requestId, before: null, after: resultBody.data,
    }),
    idempotencyStatement(env.DB, {
      companyId: context.companyId, scope: "RETAIL_CASH_SALE", key, fingerprint,
      status: 201, body: resultBody, resourceType: "SALE", resourceId: saleId,
    }),
  );

  try {
    await env.DB.batch(statements);
    return json(resultBody, 201, context.requestId);
  } catch (error) {
    const existing = await replayOrConflict(env.DB, context.companyId, "RETAIL_CASH_SALE", key, fingerprint, context.requestId);
    if (existing.response) return existing.response;
    const message = String(error?.message || "");
    if (message.includes("UNIQUE constraint failed") || message.includes("stock_quantity_after_mismatch")
      || message.includes("sale_requires_open_retail_cash_session")) {
      return json({ error: "sale_conflict_retry", requestId: context.requestId }, 409, context.requestId);
    }
    console.error("[opoint] cash sale failed", { type: error?.name || "Error" });
    return json({ error: "cash_sale_post_failed", requestId: context.requestId }, 500, context.requestId);
  }
}

export async function handleRetailWriteRoutes(request, env, identity, membership, context) {
  const url = new URL(request.url);
  if (url.pathname === "/v1/cash/sessions" && request.method === "POST") {
    return openCashSession(request, env, identity, membership, context);
  }
  const submit = url.pathname.match(/^\/v1\/cash\/sessions\/([A-Za-z0-9._:-]{1,80})\/submit$/);
  if (submit && request.method === "POST") {
    return submitCashSession(request, env, identity, membership, context, submit[1]);
  }
  const review = url.pathname.match(/^\/v1\/cash\/sessions\/([A-Za-z0-9._:-]{1,80})\/review$/);
  if (review && request.method === "POST") {
    return reviewCashSession(request, env, identity, membership, context, review[1]);
  }
  if (url.pathname === "/v1/sales" && request.method === "POST") {
    return createCashSale(request, env, identity, membership, context);
  }
  return null;
}

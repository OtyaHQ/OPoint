import { parseTransactionMessage } from "./transaction-message-parser.mjs";

type JsonRecord = Record<string, unknown>;
type StaffContext = { id: string; company_id: string; role: string };

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<T[]>;
}
interface EnterpriseEnv { DB: D1Database }

const PROVIDERS = ["AIRTEL_MONEY", "MTN_MOMO", "INTERSWITCH_QUICKTELLER"] as const;
const ACCOUNT_TYPES = ["AGENT_FLOAT", "TELLER_FLOAT", "MERCHANT_TILL", "SETTLEMENT", "COMMISSION", "OTHER"] as const;
const TX_TYPES = ["CASH_IN", "CASH_OUT", "AIRTIME", "DATA", "BILL_PAYMENT", "MERCHANT_PAYMENT", "FLOAT_TOPUP", "FLOAT_WITHDRAWAL", "REVERSAL", "OTHER"] as const;
const uuid = () => crypto.randomUUID();
const txt = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
  }
});
async function bodyJson(request: Request): Promise<JsonRecord | Response> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ error: "content_type_must_be_json" }, 415);
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 16 * 1024) return json({ error: "request_too_large" }, 413);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_body" }, 400);
    return body as JsonRecord;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
}
const isResponse = (value: JsonRecord | Response): value is Response => value instanceof Response;

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hasOutletAccess(db: D1Database, staff: StaffContext, outletId: string): Promise<boolean> {
  if (staff.role === "SOVEREIGN") return true;
  const now = new Date().toISOString();
  const assignment = await db.prepare(
    "SELECT a.id FROM omni_employee_outlet_assignments a JOIN omni_enterprise_employees e ON e.id=a.employee_id WHERE e.staff_membership_id=?1 AND e.company_id=?2 AND e.employment_status='ACTIVE' AND a.company_id=?2 AND a.outlet_id=?3 AND a.status='ACTIVE' AND a.starts_at<=?4 AND (a.ends_at IS NULL OR a.ends_at>?4) LIMIT 1"
  ).bind(staff.id, staff.company_id, outletId, now).first<{ id: string }>();
  return Boolean(assignment);
}

async function audit(db: D1Database, staff: StaffContext, requestId: string, action: string, entityType: string, entityId: string, after: unknown, reason: string) {
  await db.prepare(
    "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
  ).bind(uuid(), staff.id, action, entityType, entityId, reason, JSON.stringify(after), requestId, staff.company_id).run();
}

async function createOutlet(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const outletCode = txt(body.outletCode, 40).toUpperCase();
  const name = txt(body.name, 160);
  const address = txt(body.physicalAddress, 300);
  const type = txt(body.outletType, 32) || "RETAIL_AND_AGENCY";
  const allowedTypes = ["RETAIL", "AGENCY", "RETAIL_AND_AGENCY", "OFFICE", "WAREHOUSE"];
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(outletCode) || !name || !address || !allowedTypes.includes(type)) {
    return json({ error: "invalid_outlet" }, 400);
  }
  const latitude = body.latitude == null ? null : Number(body.latitude);
  const longitude = body.longitude == null ? null : Number(body.longitude);
  if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    return json({ error: "invalid_coordinates" }, 400);
  }
  const id = uuid();
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO omni_enterprise_outlets (id,company_id,outlet_code,name,outlet_type,status,country_code,district,city_or_town,physical_address,latitude,longitude,created_by) VALUES (?1,?2,?3,?4,?5,'PENDING','UG',?6,?7,?8,?9,?10,?11)"
      ).bind(id, staff.company_id, outletCode, name, type, txt(body.district, 100) || null, txt(body.cityOrTown, 100) || null, address, latitude, longitude, staff.id),
      env.DB.prepare(
        "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_OUTLET','OUTLET',?3,'Company owner created an outlet record',?4,?5,?6)"
      ).bind(uuid(), staff.id, id, JSON.stringify({ outletCode, name, outletType: type, status: "PENDING", createdAt: now }), requestId, staff.company_id)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "outlet_code_already_exists" }, 409);
    throw error;
  }
  return json({ data: { id, outletCode, name, outletType: type, status: "PENDING" }, requestId }, 201);
}

async function createProviderRelationship(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const provider = txt(body.provider, 40);
  const providerProduct = txt(body.providerProduct, 80);
  const legalAgentName = txt(body.legalAgentName, 180);
  if (!PROVIDERS.includes(provider as typeof PROVIDERS[number]) || !providerProduct || !legalAgentName) {
    return json({ error: "invalid_provider_relationship" }, 400);
  }
  const id = uuid();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO omni_provider_relationships (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,common_display_agent_id,agreement_reference,agreement_status,reporting_capability,notes,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'NOT_SUBMITTED','NOT_CONFIRMED',?9,?10)"
      ).bind(id, staff.company_id, provider, providerProduct, legalAgentName, txt(body.parentAgentId, 120) || null, txt(body.commonDisplayAgentId, 120) || null, txt(body.agreementReference, 120) || null, txt(body.notes, 1000) || null, staff.id),
      env.DB.prepare(
        "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_PROVIDER_RELATIONSHIP','PROVIDER_RELATIONSHIP',?3,'Company owner recorded a provider relationship; approval is not assumed',?4,?5,?6)"
      ).bind(uuid(), staff.id, id, JSON.stringify({ provider, providerProduct, agreementStatus: "NOT_SUBMITTED" }), requestId, staff.company_id)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "provider_relationship_already_exists" }, 409);
    throw error;
  }
  return json({ data: { id, provider, providerProduct, agreementStatus: "NOT_SUBMITTED" }, requestId }, 201);
}

async function createProviderOutletAccount(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const relationshipId = txt(body.providerRelationshipId, 64);
  const outletId = txt(body.outletId, 64);
  const accountLabel = txt(body.accountLabel, 120);
  const accountType = txt(body.accountType, 32);
  const accountScope = txt(body.accountScope, 16) || "OUTLET";
  if (!relationshipId || !outletId || !accountLabel ||
      !ACCOUNT_TYPES.includes(accountType as typeof ACCOUNT_TYPES[number]) ||
      !["OUTLET", "TELLER"].includes(accountScope) ||
      (accountScope === "TELLER" && accountType !== "TELLER_FLOAT")) {
    return json({ error: "invalid_provider_outlet_account" }, 400);
  }
  const parent = await env.DB.prepare(
    "SELECT r.id,r.provider,r.agreement_status,o.id AS outlet_id,o.status AS outlet_status FROM omni_provider_relationships r JOIN omni_enterprise_outlets o ON o.company_id=r.company_id WHERE r.id=?1 AND r.company_id=?2 AND o.id=?3 LIMIT 1"
  ).bind(relationshipId, staff.company_id, outletId).first<{ id: string; provider: string; agreement_status: string; outlet_id: string; outlet_status: string }>();
  if (!parent) return json({ error: "provider_relationship_or_outlet_not_found" }, 404);
  if (parent.agreement_status !== "APPROVED") return json({ error: "provider_relationship_not_approved" }, 409);
  if (parent.outlet_status !== "ACTIVE") return json({ error: "outlet_not_active" }, 409);
  const id = uuid();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO omni_provider_outlet_accounts (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,provider_account_reference,account_label,account_type,account_scope,currency,status,notes,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'UGX','PENDING',?10,?11)"
      ).bind(id, staff.company_id, relationshipId, outletId, txt(body.providerOutletId, 120) || null, txt(body.providerAccountReference, 120) || null, accountLabel, accountType, accountScope, txt(body.notes, 1000) || null, staff.id),
      env.DB.prepare(
        "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_PROVIDER_OUTLET_ACCOUNT','PROVIDER_OUTLET_ACCOUNT',?3,'Company owner recorded a pending provider-issued outlet account',?4,?5,?6)"
      ).bind(uuid(), staff.id, id, JSON.stringify({ provider: parent.provider, outletId, accountType, accountScope, status: "PENDING" }), requestId, staff.company_id)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "provider_account_conflict" }, 409);
    throw error;
  }
  return json({ data: { id, outletId, provider: parent.provider, accountType, accountScope, status: "PENDING" }, requestId }, 201);
}

async function submitTextEvidence(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const provider = txt(body.provider, 40);
  const outletId = txt(body.outletId, 64);
  const accountId = txt(body.providerOutletAccountId, 64);
  const messageText = typeof body.messageText === "string" ? body.messageText : "";
  const senderLabel = txt(body.senderLabel, 80) || null;
  if (!PROVIDERS.includes(provider as typeof PROVIDERS[number]) || !outletId || !accountId) {
    return json({ error: "provider_outlet_and_account_required" }, 400);
  }
  if (/\b(otp|one[- ]time password|pin|passcode|password|verification code)\b/i.test(messageText)) {
    return json({ error: "sensitive_message_not_accepted", detail: "Share only the transaction confirmation, never an OTP, PIN or password message." }, 422);
  }
  let parsed;
  try {
    parsed = parseTransactionMessage(messageText, provider as typeof PROVIDERS[number]);
  } catch {
    return json({ error: "message_not_parseable" }, 400);
  }
  const account = await env.DB.prepare(
    "SELECT a.id,a.outlet_id,a.account_scope,a.status,r.id AS relationship_id,r.provider,r.agreement_status FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id WHERE a.id=?1 AND a.company_id=?2 AND a.outlet_id=?3 LIMIT 1"
  ).bind(accountId, staff.company_id, outletId).first<{
    id: string; outlet_id: string; account_scope: string; status: string; relationship_id: string; provider: string; agreement_status: string;
  }>();
  if (!account || account.provider !== provider || account.status !== "ACTIVE" || account.agreement_status !== "APPROVED") {
    return json({ error: "approved_active_provider_account_required" }, 409);
  }
  const outlet = await env.DB.prepare(
    "SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(outletId, staff.company_id).first<{ id: string; status: string }>();
  if (!outlet || outlet.status !== "ACTIVE") return json({ error: "outlet_not_active" }, 409);
  if (!(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);

  if (account.account_scope === "TELLER") {
    const employee = await env.DB.prepare(
      "SELECT e.id FROM omni_enterprise_employees e JOIN omni_provider_operator_profiles p ON p.employee_id=e.id WHERE e.staff_membership_id=?1 AND e.company_id=?2 AND e.employment_status='ACTIVE' AND p.provider_outlet_account_id=?3 AND p.approval_status='APPROVED' LIMIT 1"
    ).bind(staff.id, staff.company_id, accountId).first<{ id: string }>();
    if (!employee) return json({ error: "provider_operator_not_approved_for_account" }, 403);
  }

  const sourceMessageHash = await sha256Hex(provider + "|" + accountId + "|" + messageText.trim().replace(/\s+/g, " "));
  const duplicate = await env.DB.prepare(
    "SELECT id,parse_status FROM omni_evidence_ingestion_items WHERE company_id=?1 AND provider=?2 AND source_message_hash=?3 LIMIT 1"
  ).bind(staff.company_id, provider, sourceMessageHash).first<{ id: string; parse_status: string }>();
  if (duplicate) return json({ error: "duplicate_evidence", existingEvidenceId: duplicate.id, status: duplicate.parse_status }, 409);

  const id = uuid();
  const receivedAtRaw = txt(body.receivedAt, 40);
  const receivedAt = receivedAtRaw && Number.isFinite(Date.parse(receivedAtRaw)) ? new Date(receivedAtRaw).toISOString() : null;
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO omni_evidence_ingestion_items (id,company_id,provider,outlet_id,provider_outlet_account_id,submitted_by,source_type,source_message_hash,sender_label,received_at,parser_version,extracted_fields_json,parse_confidence,parse_status) VALUES (?1,?2,?3,?4,?5,?6,'USER_SHARED_TEXT',?7,?8,?9,?10,?11,?12,'NEEDS_REVIEW')"
      ).bind(id, staff.company_id, provider, outletId, accountId, staff.id, sourceMessageHash, senderLabel, receivedAt, parsed.parserVersion, JSON.stringify(parsed), parsed.confidence),
      env.DB.prepare(
        "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'SUBMIT_TRANSACTION_EVIDENCE','TRANSACTION_EVIDENCE',?3,'Staff explicitly shared a selected message for review; raw text was not stored',?4,?5,?6)"
      ).bind(uuid(), staff.id, id, JSON.stringify({ provider, outletId, providerOutletAccountId: accountId, parserVersion: parsed.parserVersion, amountExtracted: parsed.amountUgx !== null, referenceExtracted: Boolean(parsed.providerReference), parseStatus: "NEEDS_REVIEW" }), requestId, staff.company_id)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "duplicate_evidence" }, 409);
    throw error;
  }
  return json({
    data: { evidenceId: id, provider, outletId, providerOutletAccountId: accountId, candidate: parsed, status: "NEEDS_REVIEW", providerConfirmed: false },
    requestId
  }, 201);
}

async function listTextEvidence(request: Request, env: EnterpriseEnv, staff: StaffContext) {
  const url = new URL(request.url);
  const status = txt(url.searchParams.get("status"), 32);
  const outletId = txt(url.searchParams.get("outletId"), 64);
  const allowedStatuses = ["RECEIVED", "NEEDS_REVIEW", "APPROVED_FOR_RECORDING", "REJECTED", "DUPLICATE", "FAILED"];
  if (status && !allowedStatuses.includes(status)) return json({ error: "invalid_status" }, 400);
  if (outletId && !(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);
  const clauses = ["i.company_id=?1"];
  const values: unknown[] = [staff.company_id];
  if (staff.role !== "SOVEREIGN") {
    values.push(staff.id);
    const ownParam = values.length;
    clauses.push("(i.submitted_by=?" + ownParam + " OR EXISTS (SELECT 1 FROM omni_employee_outlet_assignments a JOIN omni_enterprise_employees e ON e.id=a.employee_id WHERE e.staff_membership_id=?" + ownParam + " AND e.company_id=i.company_id AND a.outlet_id=i.outlet_id AND a.status='ACTIVE'))");
  }
  if (outletId) { values.push(outletId); clauses.push("i.outlet_id=?" + values.length); }
  if (status) { values.push(status); clauses.push("i.parse_status=?" + values.length); }
  const result = await env.DB.prepare(
    "SELECT i.id,i.provider,i.outlet_id,i.provider_outlet_account_id,i.source_type,i.sender_label,i.received_at,i.parser_version,i.extracted_fields_json,i.parse_confidence,i.parse_status,i.reviewed_by,i.reviewed_at,i.created_at FROM omni_evidence_ingestion_items i WHERE " + clauses.join(" AND ") + " ORDER BY i.created_at DESC LIMIT 100"
  ).bind(...values).all();
  return json({ data: result.results, requestId: txt(request.headers.get("cf-ray"), 80) || null });
}

async function reviewTextEvidence(request: Request, env: EnterpriseEnv, staff: StaffContext, evidenceId: string, requestId: string) {
  if (!["SOVEREIGN", "MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN"].includes(staff.role)) return json({ error: "review_permission_required" }, 403);
  const evidence = await env.DB.prepare(
    "SELECT i.id,i.company_id,i.provider,i.outlet_id,i.provider_outlet_account_id,i.submitted_by,i.extracted_fields_json,i.parse_status,a.provider_relationship_id,a.status AS account_status,r.agreement_status,e.id AS employee_id FROM omni_evidence_ingestion_items i JOIN omni_provider_outlet_accounts a ON a.id=i.provider_outlet_account_id AND a.company_id=i.company_id JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id LEFT JOIN omni_enterprise_employees e ON e.staff_membership_id=i.submitted_by AND e.company_id=i.company_id WHERE i.id=?1 AND i.company_id=?2 LIMIT 1"
  ).bind(evidenceId, staff.company_id).first<{
    id: string; company_id: string; provider: string; outlet_id: string; provider_outlet_account_id: string;
    submitted_by: string; extracted_fields_json: string; parse_status: string; provider_relationship_id: string;
    account_status: string; agreement_status: string; employee_id: string | null;
  }>();
  if (!evidence) return json({ error: "evidence_not_found" }, 404);
  if (!(await hasOutletAccess(env.DB, staff, evidence.outlet_id))) return json({ error: "outlet_access_denied" }, 403);
  if (evidence.submitted_by === staff.id) return json({ error: "maker_checker_separation_required" }, 409);
  if (evidence.parse_status !== "NEEDS_REVIEW") return json({ error: "evidence_not_pending_review" }, 409);

  const body = await bodyJson(request); if (isResponse(body)) return body;
  const decision = txt(body.decision, 40);
  const note = txt(body.note, 500) || null;
  if (decision === "REJECT") {
    await env.DB.batch([
      env.DB.prepare("UPDATE omni_evidence_ingestion_items SET parse_status='REJECTED',reviewed_by=?1,reviewed_at=CURRENT_TIMESTAMP,review_note=?2 WHERE id=?3 AND company_id=?4 AND parse_status='NEEDS_REVIEW'").bind(staff.id, note, evidenceId, staff.company_id),
      env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'REJECT_TRANSACTION_EVIDENCE','TRANSACTION_EVIDENCE',?3,?4,?5,?6,?7)").bind(uuid(), staff.id, evidenceId, note || "Reviewer rejected evidence", JSON.stringify({ status: "REJECTED" }), requestId, staff.company_id)
    ]);
    return json({ data: { evidenceId, status: "REJECTED" }, requestId });
  }
  if (decision !== "ACCEPT_FOR_RECONCILIATION") return json({ error: "invalid_review_decision" }, 400);
  if (evidence.account_status !== "ACTIVE" || evidence.agreement_status !== "APPROVED") return json({ error: "approved_active_provider_account_required" }, 409);

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(evidence.extracted_fields_json) as Record<string, unknown>; }
  catch { return json({ error: "stored_candidate_invalid" }, 409); }
  const amount = Number(parsed.amountUgx);
  const providerReference = txt(parsed.providerReference, 120);
  const transactionType = txt(parsed.transactionType, 32);
  const sourceStatusClaim = txt(parsed.sourceStatusClaim, 32);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !providerReference || !TX_TYPES.includes(transactionType as typeof TX_TYPES[number])) {
    return json({ error: "candidate_needs_manual_correction_before_acceptance" }, 422);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM omni_provider_transaction_records WHERE company_id=?1 AND provider=?2 AND provider_reference=?3 LIMIT 1"
  ).bind(staff.company_id, evidence.provider, providerReference).first<{ id: string }>();
  if (existing) return json({ error: "provider_reference_already_recorded", existingRecordId: existing.id }, 409);

  const transactionId = uuid();
  const idempotencyKey = "EVIDENCE:" + evidenceId;
  const normalizedClaim = ["SUCCESS_REPORTED", "FAILED_REPORTED", "REVERSED_REPORTED"].includes(sourceStatusClaim) ? sourceStatusClaim : "UNKNOWN";
  const level = "OPERATOR_REVIEWED";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO omni_provider_transaction_records (id,company_id,provider,provider_relationship_id,provider_outlet_account_id,outlet_id,employee_id,evidence_ingestion_id,provider_reference,transaction_type,amount_ugx,commission_ugx,source_status_claim,verification_level,recorded_by,idempotency_key) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,?13,?14,?15)"
    ).bind(transactionId, staff.company_id, evidence.provider, evidence.provider_relationship_id, evidence.provider_outlet_account_id, evidence.outlet_id, evidence.employee_id, evidenceId, providerReference, transactionType, amount, normalizedClaim, level, evidence.submitted_by, idempotencyKey),
    env.DB.prepare(
      "INSERT INTO omni_transaction_verification_events (id,company_id,transaction_record_id,verification_level,verified_by,note) VALUES (?1,?2,?3,'OPERATOR_REVIEWED',?4,?5)"
    ).bind(uuid(), staff.company_id, transactionId, staff.id, note || "A second authorised staff member reviewed the extracted message fields; provider confirmation remains outstanding."),
    env.DB.prepare(
      "UPDATE omni_evidence_ingestion_items SET parse_status='APPROVED_FOR_RECORDING',reviewed_by=?1,reviewed_at=CURRENT_TIMESTAMP,review_note=?2 WHERE id=?3 AND company_id=?4 AND parse_status='NEEDS_REVIEW'"
    ).bind(staff.id, note, evidenceId, staff.company_id),
    env.DB.prepare(
      "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'ACCEPT_TRANSACTION_EVIDENCE','TRANSACTION_EVIDENCE',?3,'Evidence reviewed for Otya recording; not provider-confirmed',?4,?5,?6)"
    ).bind(uuid(), staff.id, evidenceId, JSON.stringify({ transactionRecordId: transactionId, verificationLevel: level, providerConfirmed: false }), requestId, staff.company_id)
  ]);
  return json({ data: { evidenceId, transactionRecordId: transactionId, status: "APPROVED_FOR_RECORDING", verificationLevel: level, providerConfirmed: false }, requestId }, 201);
}

export async function handleEnterpriseIntake(
  request: Request,
  env: EnterpriseEnv,
  staff: StaffContext,
  requestId: string,
  canManage: boolean
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/v1/outlets") {
    const result = staff.role === "SOVEREIGN"
      ? await env.DB.prepare("SELECT id,outlet_code,name,outlet_type,status,district,city_or_town,physical_address,latitude,longitude,created_at FROM omni_enterprise_outlets WHERE company_id=?1 ORDER BY outlet_code").bind(staff.company_id).all()
      : await env.DB.prepare("SELECT o.id,o.outlet_code,o.name,o.outlet_type,o.status,o.district,o.city_or_town,o.physical_address,o.latitude,o.longitude,o.created_at FROM omni_enterprise_outlets o JOIN omni_employee_outlet_assignments a ON a.outlet_id=o.id JOIN omni_enterprise_employees e ON e.id=a.employee_id WHERE o.company_id=?1 AND e.staff_membership_id=?2 AND e.company_id=?1 AND e.employment_status='ACTIVE' AND a.status='ACTIVE' AND o.status='ACTIVE' GROUP BY o.id ORDER BY o.outlet_code").bind(staff.company_id, staff.id).all();
    return json({ data: result.results, requestId });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/outlets") return createOutlet(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/provider-relationships") return createProviderRelationship(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/provider-outlet-accounts") return createProviderOutletAccount(request, env, staff, requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/provider-relationships") {
    if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
    const result = await env.DB.prepare("SELECT id,provider,provider_product,legal_agent_name,parent_agent_id,common_display_agent_id,agreement_reference,agreement_status,reporting_capability,starts_at,ends_at,created_at FROM omni_provider_relationships WHERE company_id=?1 ORDER BY provider,provider_product").bind(staff.company_id).all();
    return json({ data: result.results, requestId });
  }
  if (request.method === "GET" && url.pathname === "/api/v1/provider-outlet-accounts") {
    const result = staff.role === "SOVEREIGN"
      ? await env.DB.prepare("SELECT a.id,a.provider_relationship_id,a.outlet_id,r.provider,r.provider_product,a.provider_outlet_id,a.provider_account_reference,a.account_label,a.account_type,a.account_scope,a.status,a.currency FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id WHERE a.company_id=?1 ORDER BY r.provider,a.outlet_id,a.account_label").bind(staff.company_id).all()
      : await env.DB.prepare("SELECT a.id,a.provider_relationship_id,a.outlet_id,r.provider,r.provider_product,a.provider_outlet_id,a.provider_account_reference,a.account_label,a.account_type,a.account_scope,a.status,a.currency FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id JOIN omni_employee_outlet_assignments x ON x.outlet_id=a.outlet_id JOIN omni_enterprise_employees e ON e.id=x.employee_id WHERE a.company_id=?1 AND e.staff_membership_id=?2 AND e.company_id=?1 AND e.employment_status='ACTIVE' AND x.status='ACTIVE' GROUP BY a.id ORDER BY r.provider,a.outlet_id,a.account_label").bind(staff.company_id, staff.id).all();
    return json({ data: result.results, requestId });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/transaction-evidence/text") return submitTextEvidence(request, env, staff, requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/transaction-evidence") return listTextEvidence(request, env, staff);
  const reviewMatch = url.pathname.match(/^\/api\/v1\/transaction-evidence\/([^/]+)\/review$/);
  if (request.method === "POST" && reviewMatch) return reviewTextEvidence(request, env, staff, txt(reviewMatch[1], 64), requestId);
  return null;
}

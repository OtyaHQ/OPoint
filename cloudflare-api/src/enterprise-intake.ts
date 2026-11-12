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
interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: {
    httpMetadata?: { contentType?: string; contentDisposition?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; httpMetadata?: { contentType?: string; contentDisposition?: string }; size: number } | null>;
  delete(key: string): Promise<void>;
}
interface EnterpriseEnv { DB: D1Database; PRIVATE_FILES?: R2Bucket }

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


const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const evidenceContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const evidenceTypes = new Set([
  "PROVIDER_RECEIPT",
  "PROVIDER_STATEMENT",
  "SMS_SCREENSHOT",
  "SHARED_MESSAGE_EXPORT",
  "RETAIL_RECEIPT",
  "SUPPLIER_INVOICE",
  "STAFF_DOCUMENT",
  "OTHER"
]);

function safeFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const leaf = value.replace(/\\/g, "/").split("/").pop() || "";
  const safe = leaf.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  return safe || null;
}

function fileExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
    "text/csv": "csv",
    "text/plain": "txt",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
  };
  return map[contentType] || "bin";
}

async function readFileBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array | Response> {
  if (!request.body) return json({ error: "file_body_required" }, 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return json({ error: "file_too_large", maxBytes }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "file_upload_interrupted" }, 400);
  }
  if (total === 0) return json({ error: "empty_file" }, 400);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function uploadEvidenceFile(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (!env.PRIVATE_FILES) return json({ error: "private_file_storage_unavailable" }, 503);
  const url = new URL(request.url);
  const outletId = txt(request.headers.get("x-otya-outlet-id"), 64);
  const evidenceType = txt(request.headers.get("x-otya-evidence-type"), 40);
  const fileName = safeFileName(request.headers.get("x-file-name"));
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!outletId || !evidenceTypes.has(evidenceType) || !evidenceContentTypes.has(contentType)) {
    return json({ error: "outlet_evidence_type_and_supported_content_type_required" }, 400);
  }
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_EVIDENCE_BYTES) return json({ error: "file_too_large", maxBytes: MAX_EVIDENCE_BYTES }, 413);
  if (!(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);
  const outlet = await env.DB.prepare(
    "SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(outletId, staff.company_id).first<{ id: string; status: string }>();
  if (!outlet || outlet.status !== "ACTIVE") return json({ error: "active_outlet_required" }, 409);

  const bytes = await readFileBodyLimited(request, MAX_EVIDENCE_BYTES);
  if (bytes instanceof Response) return bytes;
  if (declaredLength && declaredLength !== bytes.byteLength) return json({ error: "content_length_mismatch" }, 400);

  const id = uuid();
  const key = staff.company_id + "/evidence/" + outletId + "/" + id + "." + fileExtension(contentType);
  const retentionClass = ["STAFF_DOCUMENT"].includes(evidenceType) ? "PERSONNEL_CONFIDENTIAL" :
    ["PROVIDER_STATEMENT", "PROVIDER_RECEIPT", "RETAIL_RECEIPT", "SUPPLIER_INVOICE"].includes(evidenceType) ? "FINANCIAL_CONFIDENTIAL" : "BUSINESS_RECORD";
  try {
    await env.PRIVATE_FILES.put(key, bytes, {
      httpMetadata: { contentType, contentDisposition: "attachment" },
      customMetadata: {
        companyId: staff.company_id,
        outletId,
        evidenceId: id,
        evidenceType
      }
    });
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO omni_evidence_files (id,company_id,outlet_id,uploaded_by,storage_object_key,original_filename,content_type,size_bytes,evidence_type,retention_class) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
        ).bind(id, staff.company_id, outletId, staff.id, key, fileName, contentType, bytes.byteLength, evidenceType, retentionClass),
        env.DB.prepare(
          "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'UPLOAD_EVIDENCE_FILE','EVIDENCE_FILE',?3,'Uploaded a private company evidence file',?4,?5,?6)"
        ).bind(uuid(), staff.id, id, JSON.stringify({ outletId, evidenceType, contentType, sizeBytes: bytes.byteLength }), requestId, staff.company_id)
      ]);
    } catch (error) {
      await env.PRIVATE_FILES.delete(key).catch(() => {});
      throw error;
    }
  } catch {
    return json({ error: "evidence_storage_failed" }, 503);
  }
  return json({
    data: {
      evidenceFileId: id,
      outletId,
      evidenceType,
      contentType,
      sizeBytes: bytes.byteLength,
      processingStatus: "UPLOADED_NEEDS_EXTRACTION",
      private: true
    },
    requestId
  }, 201);
}

async function downloadEvidenceFile(request: Request, env: EnterpriseEnv, staff: StaffContext, evidenceId: string) {
  if (!env.PRIVATE_FILES) return json({ error: "private_file_storage_unavailable" }, 503);
  const row = await env.DB.prepare(
    "SELECT id,outlet_id,storage_object_key,original_filename,content_type,size_bytes FROM omni_evidence_files WHERE id=?1 AND company_id=?2 AND deleted_at IS NULL LIMIT 1"
  ).bind(evidenceId, staff.company_id).first<{
    id: string; outlet_id: string | null; storage_object_key: string; original_filename: string | null;
    content_type: string; size_bytes: number;
  }>();
  if (!row) return json({ error: "evidence_file_not_found" }, 404);
  if (row.outlet_id && !(await hasOutletAccess(env.DB, staff, row.outlet_id))) return json({ error: "outlet_access_denied" }, 403);
  const object = await env.PRIVATE_FILES.get(row.storage_object_key);
  if (!object) return json({ error: "evidence_object_missing" }, 404);
  const safeName = (row.original_filename || ("evidence-" + row.id)).replace(/["\r\n]/g, "_").slice(0, 100);
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-length": String(row.size_bytes),
      "content-disposition": "attachment; filename=\"" + safeName + "\"",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
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
  let parsed: ReturnType<typeof parseTransactionMessage>;
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


async function updateOutletStatus(request: Request, env: EnterpriseEnv, staff: StaffContext, outletId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const status = txt(body.status, 20);
  const reason = txt(body.reason, 300);
  if (!["ACTIVE", "SUSPENDED", "CLOSED"].includes(status) || !reason) return json({ error: "valid_status_and_reason_required" }, 400);
  const outlet = await env.DB.prepare("SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(outletId, staff.company_id).first<{ id: string; status: string }>();
  if (!outlet) return json({ error: "outlet_not_found" }, 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_enterprise_outlets SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3")
      .bind(status, outletId, staff.company_id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_OUTLET_STATUS','OUTLET',?3,?4,?5,?6,?7,?8)")
      .bind(uuid(), staff.id, outletId, reason, JSON.stringify({ status: outlet.status }), JSON.stringify({ status }), requestId, staff.company_id)
  ]);
  return json({ data: { id: outletId, status }, requestId });
}

async function updateProviderRelationship(request: Request, env: EnterpriseEnv, staff: StaffContext, relationshipId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const relationship = await env.DB.prepare(
    "SELECT id,provider,agreement_status,agreement_reference FROM omni_provider_relationships WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(relationshipId, staff.company_id).first<{ id: string; provider: string; agreement_status: string; agreement_reference: string | null }>();
  if (!relationship) return json({ error: "provider_relationship_not_found" }, 404);
  const status = txt(body.agreementStatus, 24);
  const reason = txt(body.reason, 300);
  const approvalReference = txt(body.providerApprovalReference, 120);
  const allowed = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SUSPENDED", "TERMINATED"];
  if (!allowed.includes(status) || !reason) return json({ error: "valid_agreement_status_and_reason_required" }, 400);
  if (status === "APPROVED" && !approvalReference) {
    return json({ error: "provider_approval_reference_required", detail: "Record the provider-issued agreement/approval reference before marking an arrangement approved." }, 422);
  }
  const agreementReference = approvalReference || txt(body.agreementReference, 120) || relationship.agreement_reference;
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_provider_relationships SET agreement_status=?1,agreement_reference=?2,common_display_agent_id=COALESCE(?3,common_display_agent_id),parent_agent_id=COALESCE(?4,parent_agent_id),updated_at=CURRENT_TIMESTAMP WHERE id=?5 AND company_id=?6")
      .bind(status, agreementReference, txt(body.commonDisplayAgentId, 120) || null, txt(body.parentAgentId, 120) || null, relationshipId, staff.company_id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_PROVIDER_RELATIONSHIP','PROVIDER_RELATIONSHIP',?3,?4,?5,?6,?7,?8)")
      .bind(uuid(), staff.id, relationshipId, reason, JSON.stringify({ agreementStatus: relationship.agreement_status, agreementReference: relationship.agreement_reference }), JSON.stringify({ agreementStatus: status, agreementReference }), requestId, staff.company_id)
  ]);
  return json({ data: { id: relationshipId, provider: relationship.provider, agreementStatus: status, agreementReference }, requestId });
}

async function updateProviderOutletAccount(request: Request, env: EnterpriseEnv, staff: StaffContext, accountId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const account = await env.DB.prepare(
    "SELECT a.id,a.status,a.provider_outlet_id,a.provider_account_reference,a.account_type,r.agreement_status FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id WHERE a.id=?1 AND a.company_id=?2 LIMIT 1"
  ).bind(accountId, staff.company_id).first<{
    id: string; status: string; provider_outlet_id: string | null; provider_account_reference: string | null;
    account_type: string; agreement_status: string;
  }>();
  if (!account) return json({ error: "provider_outlet_account_not_found" }, 404);
  const status = txt(body.status, 20);
  const reason = txt(body.reason, 300);
  if (!["ACTIVE", "SUSPENDED", "CLOSED", "PENDING"].includes(status) || !reason) {
    return json({ error: "valid_status_and_reason_required" }, 400);
  }
  const providerOutletId = txt(body.providerOutletId, 120) || account.provider_outlet_id;
  const providerAccountReference = txt(body.providerAccountReference, 120) || account.provider_account_reference;
  if (status === "ACTIVE" && account.agreement_status !== "APPROVED") return json({ error: "provider_relationship_not_approved" }, 409);
  if (status === "ACTIVE" && !providerOutletId && !providerAccountReference) {
    return json({ error: "provider_issued_outlet_or_account_reference_required" }, 422);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_provider_outlet_accounts SET status=?1,provider_outlet_id=?2,provider_account_reference=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND company_id=?5")
      .bind(status, providerOutletId, providerAccountReference, accountId, staff.company_id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_PROVIDER_OUTLET_ACCOUNT','PROVIDER_OUTLET_ACCOUNT',?3,?4,?5,?6,?7,?8)")
      .bind(uuid(), staff.id, accountId, reason, JSON.stringify({ status: account.status }), JSON.stringify({ status, providerOutletId, providerAccountReference }), requestId, staff.company_id)
  ]);
  return json({ data: { id: accountId, status, providerOutletId, providerAccountReference }, requestId });
}

async function getCompanyProfile(env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const profile = await env.DB.prepare("SELECT company_id,legal_name,trading_name,registration_number,tin,legal_status,incorporation_date,registered_address,principal_business_address,business_email,business_phone,website,country_code,currency,timezone,updated_at FROM omni_enterprise_company_profiles WHERE company_id=?1 LIMIT 1")
    .bind(staff.company_id).first();
  return json({ data: profile, requestId });
}

async function saveCompanyProfile(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const legalStatus = txt(body.legalStatus, 32) || "NOT_REGISTERED";
  const allowed = ["NOT_REGISTERED", "REGISTRATION_IN_PROGRESS", "REGISTERED", "SUSPENDED"];
  const legalName = txt(body.legalName, 180) || null;
  const registrationNumber = txt(body.registrationNumber, 120) || null;
  const tin = txt(body.tin, 80) || null;
  if (!allowed.includes(legalStatus)) return json({ error: "invalid_legal_status" }, 400);
  if (legalStatus === "REGISTERED" && (!legalName || !registrationNumber || !tin)) {
    return json({ error: "registered_company_name_registration_number_and_tin_required" }, 422);
  }
  await env.DB.prepare(
    "INSERT INTO omni_enterprise_company_profiles (company_id,legal_name,trading_name,registration_number,tin,legal_status,incorporation_date,registered_address,principal_business_address,business_email,business_phone,website,country_code,currency,timezone,updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'UG','UGX','Africa/Kampala',?13) ON CONFLICT(company_id) DO UPDATE SET legal_name=excluded.legal_name,trading_name=excluded.trading_name,registration_number=excluded.registration_number,tin=excluded.tin,legal_status=excluded.legal_status,incorporation_date=excluded.incorporation_date,registered_address=excluded.registered_address,principal_business_address=excluded.principal_business_address,business_email=excluded.business_email,business_phone=excluded.business_phone,website=excluded.website,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP"
  ).bind(staff.company_id, legalName, txt(body.tradingName, 180) || null, registrationNumber, tin, legalStatus, txt(body.incorporationDate, 20) || null, txt(body.registeredAddress, 300) || null, txt(body.principalBusinessAddress, 300) || null, txt(body.businessEmail, 254) || null, txt(body.businessPhone, 40) || null, txt(body.website, 180) || null, staff.id).run();
  await audit(env.DB, staff, requestId, "UPDATE_COMPANY_PROFILE", "COMPANY_PROFILE", staff.company_id, { legalName, registrationNumber, tin, legalStatus }, "Company owner updated company identity records");
  return getCompanyProfile(env, staff, requestId);
}

async function createAgencyReceipt(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const transactionId = txt(body.transactionRecordId, 64);
  if (!transactionId) return json({ error: "transaction_record_id_required" }, 400);
  const row = await env.DB.prepare(
    "SELECT t.id,t.provider,t.outlet_id,t.provider_reference,t.transaction_type,t.amount_ugx,t.source_status_claim,t.verification_level,t.recorded_by,o.name AS outlet_name,o.physical_address,e.legal_name,e.trading_name,m.display_name FROM omni_provider_transaction_records t JOIN omni_enterprise_outlets o ON o.id=t.outlet_id AND o.company_id=t.company_id LEFT JOIN omni_enterprise_company_profiles e ON e.company_id=t.company_id LEFT JOIN omni_staff_memberships m ON m.id=t.recorded_by WHERE t.id=?1 AND t.company_id=?2 LIMIT 1"
  ).bind(transactionId, staff.company_id).first<{
    id: string; provider: string; outlet_id: string; provider_reference: string | null; transaction_type: string;
    amount_ugx: number; source_status_claim: string; verification_level: string; recorded_by: string;
    outlet_name: string; physical_address: string; legal_name: string | null; trading_name: string | null; display_name: string | null;
  }>();
  if (!row) return json({ error: "transaction_record_not_found" }, 404);
  if (!(await hasOutletAccess(env.DB, staff, row.outlet_id))) return json({ error: "outlet_access_denied" }, 403);
  if (row.source_status_claim !== "SUCCESS_REPORTED") return json({ error: "source_does_not_report_success", detail: "A customer acknowledgement is only available for a source that reports success. This does not independently verify provider settlement." }, 409);
  const existing = await env.DB.prepare(
    "SELECT id,receipt_number,receipt_type,receipt_status,content_snapshot_json,customer_disclaimer FROM omni_receipt_documents WHERE company_id=?1 AND source_type='PROVIDER_TRANSACTION_RECORD' AND source_id=?2 LIMIT 1"
  ).bind(staff.company_id, transactionId).first();
  if (existing) return json({ data: existing, replayed: true, requestId });
  const id = uuid();
  const receiptNumber = "OTYA-AG-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + id.slice(0,8).toUpperCase();
  const disclaimer = "Otya company service acknowledgement only. It is not a provider-issued receipt and does not replace the official provider confirmation. The provider's official receipt and records remain authoritative.";
  const snapshot = {
    receiptNumber,
    receiptType: "AGENCY_SERVICE_ACKNOWLEDGEMENT",
    companyName: row.legal_name,
    tradingName: row.trading_name,
    outlet: { name: row.outlet_name, address: row.physical_address },
    provider: row.provider,
    providerReference: row.provider_reference,
    transactionType: row.transaction_type,
    amountUgx: row.amount_ugx,
    currency: "UGX",
    sourceStatus: row.source_status_claim,
    verificationLevel: row.verification_level,
    recordedBy: row.display_name,
    issuedAt: new Date().toISOString(),
    disclaimer
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO omni_receipt_documents (id,company_id,outlet_id,receipt_number,receipt_type,source_type,source_id,provider,provider_reference,verification_label,receipt_status,currency,total_ugx,content_snapshot_json,customer_disclaimer,issued_by) VALUES (?1,?2,?3,?4,'AGENCY_SERVICE_ACKNOWLEDGEMENT','PROVIDER_TRANSACTION_RECORD',?5,?6,?7,'SOURCE_EVIDENCE_REVIEWED','ISSUED','UGX',?8,?9,?10,?11)"
    ).bind(id, staff.company_id, row.outlet_id, receiptNumber, transactionId, row.provider, row.provider_reference, row.amount_ugx, JSON.stringify(snapshot), disclaimer, staff.id),
    env.DB.prepare(
      "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'ISSUE_AGENCY_ACKNOWLEDGEMENT','RECEIPT',?3,'Issued a supplementary Otya acknowledgement; provider receipt remains authoritative',?4,?5,?6)"
    ).bind(uuid(), staff.id, id, JSON.stringify({ receiptNumber, transactionRecordId: transactionId, verificationLabel: "SOURCE_EVIDENCE_REVIEWED" }), requestId, staff.company_id)
  ]);
  return json({ data: { id, receiptNumber, receiptType: "AGENCY_SERVICE_ACKNOWLEDGEMENT", receiptStatus: "ISSUED", content: snapshot, pdfReady: false }, requestId }, 201);
}

async function createRetailReceipt(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const saleId = txt(body.saleId, 64);
  const outletId = txt(body.outletId, 64);
  if (!saleId || !outletId) return json({ error: "sale_id_and_outlet_id_required" }, 400);
  if (!(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);
  const [sale, outlet, company] = await Promise.all([
    env.DB.prepare("SELECT id,receipt_number,status,subtotal,discount_total,tax_total,total,payment_method,efris_status,efris_invoice_id,actor_id,outlet_id FROM omni_retail_sales WHERE id=?1 AND company_id=?2 LIMIT 1")
      .bind(saleId, staff.company_id).first<{
        id: string; receipt_number: string; status: string; subtotal: number; discount_total: number; tax_total: number; total: number;
        payment_method: string; efris_status: string; efris_invoice_id: string | null; actor_id: string; outlet_id: string | null;
      }>(),
    env.DB.prepare("SELECT id,name,physical_address FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 AND status='ACTIVE' LIMIT 1")
      .bind(outletId, staff.company_id).first<{ id: string; name: string; physical_address: string }>(),
    env.DB.prepare("SELECT legal_name,trading_name,legal_status,registration_number,tin FROM omni_enterprise_company_profiles WHERE company_id=?1 LIMIT 1")
      .bind(staff.company_id).first<{ legal_name: string | null; trading_name: string | null; legal_status: string; registration_number: string | null; tin: string | null }>()
  ]);
  if (!sale || sale.status !== "COMPLETED") return json({ error: "completed_sale_not_found" }, 404);
  if (!outlet) return json({ error: "active_outlet_not_found" }, 404);
  if (sale.outlet_id && sale.outlet_id !== outletId) return json({ error: "sale_already_assigned_to_another_outlet" }, 409);
  const existing = await env.DB.prepare(
    "SELECT id,receipt_number,receipt_type,receipt_status,content_snapshot_json,customer_disclaimer FROM omni_receipt_documents WHERE company_id=?1 AND source_type='RETAIL_SALE' AND source_id=?2 LIMIT 1"
  ).bind(staff.company_id, saleId).first();
  if (existing) return json({ data: existing, replayed: true, requestId });
  const lines = await env.DB.prepare(
    "SELECT sku_snapshot,name_snapshot,quantity,unit_price,line_total FROM omni_retail_sale_lines WHERE sale_id=?1 ORDER BY rowid"
  ).bind(saleId).all<{ sku_snapshot: string; name_snapshot: string; quantity: number; unit_price: number; line_total: number }>();
  const id = uuid();
  const receiptType = "RETAIL_SALES_RECEIPT";
  const disclaimer = sale.efris_status === "SUCCEEDED" && sale.efris_invoice_id
    ? "Retail receipt. Refer to the EFRIS fiscal invoice number shown for the official fiscal document."
    : "Retail sales receipt. This document is not an EFRIS fiscal invoice unless a separate official fiscal invoice has been successfully issued.";
  const snapshot = {
    receiptNumber: sale.receipt_number,
    receiptType,
    company: { legalName: company?.legal_name ?? null, tradingName: company?.trading_name ?? null, registrationNumber: company?.registration_number ?? null, tin: company?.tin ?? null, legalStatus: company?.legal_status ?? "NOT_CONFIGURED" },
    outlet: { name: outlet.name, address: outlet.physical_address },
    issuedAt: new Date().toISOString(),
    items: lines.results.map(line => ({ sku: line.sku_snapshot, name: line.name_snapshot, quantity: line.quantity, unitPriceUgx: line.unit_price, lineTotalUgx: line.line_total })),
    subtotalUgx: sale.subtotal,
    discountUgx: sale.discount_total,
    taxUgx: sale.tax_total,
    totalUgx: sale.total,
    currency: "UGX",
    paymentMethod: sale.payment_method,
    efris: { status: sale.efris_status, invoiceId: sale.efris_invoice_id },
    disclaimer
  };
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_retail_sales SET outlet_id=?1 WHERE id=?2 AND company_id=?3 AND outlet_id IS NULL")
      .bind(outletId, saleId, staff.company_id),
    env.DB.prepare(
      "INSERT INTO omni_receipt_documents (id,company_id,outlet_id,receipt_number,receipt_type,source_type,source_id,verification_label,receipt_status,currency,total_ugx,content_snapshot_json,customer_disclaimer,issued_by) VALUES (?1,?2,?3,?4,'RETAIL_SALES_RECEIPT','RETAIL_SALE',?5,'INTERNAL_RECORD_ONLY','ISSUED','UGX',?6,?7,?8,?9)"
    ).bind(id, staff.company_id, outletId, sale.receipt_number, saleId, sale.total, JSON.stringify(snapshot), disclaimer, staff.id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'ISSUE_RETAIL_RECEIPT','RECEIPT',?3,'Issued Otya retail sales receipt from a completed sale',?4,?5,?6)")
      .bind(uuid(), staff.id, id, JSON.stringify({ receiptNumber: sale.receipt_number, saleId, outletId, receiptType }), requestId, staff.company_id)
  ]);
  return json({ data: { id, receiptNumber: sale.receipt_number, receiptType, receiptStatus: "ISSUED", content: snapshot, pdfReady: false }, requestId }, 201);
}


async function recordProviderBalance(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const accountId = txt(body.providerOutletAccountId, 64);
  const outletId = txt(body.outletId, 64);
  const reportedBalance = Number(body.reportedBalanceUgx);
  const sourceType = txt(body.sourceType, 40);
  const allowedSources = ["PROVIDER_PORTAL", "PROVIDER_STATEMENT", "PROVIDER_RECEIPT", "USER_SHARED_TEXT", "MANUAL_ENTRY"];
  if (!accountId || !outletId || !Number.isSafeInteger(reportedBalance) || reportedBalance < 0 || !allowedSources.includes(sourceType)) {
    return json({ error: "valid_account_outlet_balance_and_source_required" }, 400);
  }
  if (!(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);
  const account = await env.DB.prepare(
    "SELECT a.id,a.outlet_id,a.status,r.provider,r.agreement_status FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id WHERE a.id=?1 AND a.company_id=?2 AND a.outlet_id=?3 LIMIT 1"
  ).bind(accountId, staff.company_id, outletId).first<{
    id: string; outlet_id: string; status: string; provider: string; agreement_status: string;
  }>();
  if (!account || account.status !== "ACTIVE" || account.agreement_status !== "APPROVED") {
    return json({ error: "approved_active_provider_account_required" }, 409);
  }
  const observedAtRaw = txt(body.observedAt, 48);
  const observedAt = observedAtRaw && Number.isFinite(Date.parse(observedAtRaw))
    ? new Date(observedAtRaw).toISOString()
    : new Date().toISOString();
  let evidenceFileId = txt(body.evidenceFileId, 64) || null;
  let verificationLevel = "UNVERIFIED";
  if (sourceType === "PROVIDER_STATEMENT" && evidenceFileId && ["SOVEREIGN","MANAGER","MANAGING_DIRECTOR","CHAIRMAN"].includes(staff.role)) {
    const evidence = await env.DB.prepare(
      "SELECT id,evidence_type,outlet_id,uploaded_by FROM omni_evidence_files WHERE id=?1 AND company_id=?2 AND deleted_at IS NULL LIMIT 1"
    ).bind(evidenceFileId, staff.company_id).first<{id:string;evidence_type:string;outlet_id:string|null;uploaded_by:string}>();
    if (!evidence || evidence.evidence_type !== "PROVIDER_STATEMENT" || (evidence.outlet_id && evidence.outlet_id !== outletId)) {
      return json({ error: "matching_provider_statement_evidence_required" }, 422);
    }
    if (evidence.uploaded_by === staff.id) return json({ error: "maker_checker_separation_required" }, 409);
    verificationLevel = "STATEMENT_MATCHED";
  }
  const id = uuid();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO omni_provider_balance_observations (id,company_id,provider,provider_outlet_account_id,outlet_id,reported_balance_ugx,source_type,verification_level,evidence_file_id,observed_at,recorded_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"
    ).bind(id, staff.company_id, account.provider, accountId, outletId, reportedBalance, sourceType, verificationLevel, evidenceFileId, observedAt, staff.id),
    env.DB.prepare(
      "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'RECORD_PROVIDER_BALANCE','PROVIDER_BALANCE',?3,'Recorded a provider balance observation; no provider funds were moved',?4,?5,?6)"
    ).bind(uuid(), staff.id, id, JSON.stringify({ provider: account.provider, outletId, accountId, sourceType, verificationLevel, reportedBalanceUgx: reportedBalance, observedAt }), requestId, staff.company_id)
  ]);
  return json({
    data: { id, provider: account.provider, outletId, providerOutletAccountId: accountId, reportedBalanceUgx: reportedBalance, currency: "UGX", sourceType, verificationLevel, observedAt },
    requestId
  }, 201);
}

async function listProviderBalances(request: Request, env: EnterpriseEnv, staff: StaffContext, summary: boolean) {
  const url = new URL(request.url);
  const outletId = txt(url.searchParams.get("outletId"), 64);
  if (outletId && !(await hasOutletAccess(env.DB, staff, outletId))) return json({ error: "outlet_access_denied" }, 403);
  const rows = await env.DB.prepare(
    "SELECT b.id,b.provider,b.provider_outlet_account_id,b.outlet_id,a.account_label,a.account_type,a.provider_outlet_id,a.provider_account_reference,o.outlet_code,o.name AS outlet_name,b.reported_balance_ugx,b.currency,b.source_type,b.verification_level,b.evidence_file_id,b.observed_at,b.recorded_by,b.created_at FROM omni_provider_balance_observations b JOIN omni_provider_outlet_accounts a ON a.id=b.provider_outlet_account_id AND a.company_id=b.company_id JOIN omni_enterprise_outlets o ON o.id=b.outlet_id AND o.company_id=b.company_id WHERE b.company_id=?1 ORDER BY b.observed_at DESC LIMIT 500"
  ).bind(staff.company_id).all<Record<string, unknown>>();
  const allowed = [];
  for (const row of rows.results) {
    const rowOutlet = String(row.outlet_id);
    if (outletId && rowOutlet !== outletId) continue;
    if (staff.role !== "SOVEREIGN" && !(await hasOutletAccess(env.DB, staff, rowOutlet))) continue;
    allowed.push(row);
  }
  const now = Date.now();
  if (!summary) return json({ data: allowed.slice(0, 200), requestId: txt(request.headers.get("cf-ray"), 80) || null });
  const seen = new Set<string>();
  const latest = [];
  for (const row of allowed) {
    const key = String(row.provider_outlet_account_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const observedAt = Date.parse(String(row.observed_at));
    latest.push({
      ...row,
      isStale: !Number.isFinite(observedAt) || now - observedAt > 24 * 60 * 60 * 1000,
      ageSeconds: Number.isFinite(observedAt) ? Math.max(0, Math.floor((now - observedAt) / 1000)) : null
    });
  }
  const totals = new Map<string, number>();
  for (const row of latest) {
    const p = String(row.provider);
    totals.set(p, (totals.get(p) || 0) + Number(row.reported_balance_ugx));
  }
  return json({
    data: {
      accounts: latest,
      providerReportedTotals: Array.from(totals.entries()).map(([provider, amountUgx]) => ({ provider, amountUgx, currency: "UGX" })),
      balanceNature: "LATEST_RECORDED_PROVIDER_OBSERVATIONS_NOT_LIVE_UNLESS_READ_ONLY_PROVIDER_CONFIRMED",
      generatedAt: new Date().toISOString()
    },
    requestId: txt(request.headers.get("cf-ray"), 80) || null
  });
}

async function createEmployee(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const membershipId = txt(body.staffMembershipId, 64);
  const employeeNumber = txt(body.employeeNumber, 40).toUpperCase();
  const legalName = txt(body.legalName, 180);
  if (!membershipId || !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(employeeNumber) || !legalName) {
    return json({ error: "staff_membership_employee_number_and_legal_name_required" }, 400);
  }
  const membership = await env.DB.prepare(
    "SELECT id,company_id,status FROM omni_staff_memberships WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(membershipId, staff.company_id).first<{id:string;company_id:string;status:string}>();
  if (!membership || !["ACTIVE","PENDING"].includes(membership.status)) return json({ error: "eligible_staff_membership_required" }, 404);
  const employeeId = uuid();
  const employmentType = txt(body.employmentType, 24) || "FULL_TIME";
  const employmentTypes = ["FULL_TIME","PART_TIME","CASUAL","CONTRACT","DIRECTOR","INTERN"];
  if (!employmentTypes.includes(employmentType)) return json({ error: "invalid_employment_type" }, 400);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO omni_enterprise_employees (id,company_id,staff_membership_id,employee_number,legal_name,preferred_name,department_id,job_title,employment_type,employment_status,start_date,work_email,work_phone) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'ONBOARDING',?10,?11,?12)"
      ).bind(employeeId, staff.company_id, membershipId, employeeNumber, legalName, txt(body.preferredName, 120) || null, txt(body.departmentId, 64) || null, txt(body.jobTitle, 120) || null, employmentType, txt(body.startDate, 20) || null, txt(body.workEmail, 254) || null, txt(body.workPhone, 40) || null),
      env.DB.prepare(
        "INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'CREATE_EMPLOYEE','EMPLOYEE',?3,'Company owner created an employment record linked to an existing Otya staff membership',?4,?5,?6)"
      ).bind(uuid(), staff.id, employeeId, JSON.stringify({ employeeNumber, legalName, employmentType, employmentStatus: "ONBOARDING" }), requestId, staff.company_id)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "employee_number_or_membership_already_used" }, 409);
    throw error;
  }
  return json({ data: { id: employeeId, employeeNumber, legalName, employmentType, employmentStatus: "ONBOARDING" }, requestId }, 201);
}

async function assignEmployeeToOutlet(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const employeeId = txt(body.employeeId, 64);
  const outletId = txt(body.outletId, 64);
  const assignmentRole = txt(body.assignmentRole, 60);
  if (!employeeId || !outletId || !assignmentRole) return json({ error: "employee_outlet_and_assignment_role_required" }, 400);
  const employee = await env.DB.prepare("SELECT id,employment_status FROM omni_enterprise_employees WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(employeeId, staff.company_id).first<{id:string;employment_status:string}>();
  const outlet = await env.DB.prepare("SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(outletId, staff.company_id).first<{id:string;status:string}>();
  if (!employee || !outlet) return json({ error: "employee_or_outlet_not_found" }, 404);
  if (outlet.status !== "ACTIVE" || employee.employment_status === "TERMINATED") return json({ error: "active_outlet_and_non_terminated_employee_required" }, 409);
  const id = uuid();
  const startsAtRaw = txt(body.startsAt, 48);
  const startsAt = startsAtRaw && Number.isFinite(Date.parse(startsAtRaw)) ? new Date(startsAtRaw).toISOString() : new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO omni_employee_outlet_assignments (id,company_id,employee_id,outlet_id,assignment_role,is_primary,starts_at,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
    ).bind(id, staff.company_id, employeeId, outletId, assignmentRole, body.isPrimary === true ? 1 : 0, startsAt, staff.id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("EMPLOYEE_OUTLET_COMPANY_MISMATCH")) return json({ error: "employee_outlet_company_mismatch" }, 409);
    throw error;
  }
  await audit(env.DB, staff, requestId, "ASSIGN_EMPLOYEE_TO_OUTLET", "EMPLOYEE_OUTLET_ASSIGNMENT", id, { employeeId, outletId, assignmentRole, startsAt }, "Company owner assigned an employee to an outlet");
  return json({ data: { id, employeeId, outletId, assignmentRole, startsAt, status: "ACTIVE" }, requestId }, 201);
}

async function registerCompanySim(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const carrier = txt(body.carrier, 20);
  const msisdn = txt(body.msisdn, 32);
  const useType = txt(body.useType, 30);
  if (!["AIRTEL","MTN","OTHER"].includes(carrier) || !/^\+?[0-9]{9,15}$/.test(msisdn.replace(/[\s-]/g,"")) ||
      !["AGENCY_OPERATION","BUSINESS_VOICE_DATA","DEVICE_CONNECTIVITY","OTHER"].includes(useType)) {
    return json({ error: "valid_carrier_company_number_and_use_type_required" }, 400);
  }
  const id = uuid();
  try {
    await env.DB.prepare(
      "INSERT INTO omni_company_sim_cards (id,company_id,carrier,msisdn,iccid,company_registration_status,use_type,created_by) VALUES (?1,?2,?3,?4,?5,'PENDING',?6,?7)"
    ).bind(id, staff.company_id, carrier, msisdn.replace(/[\\s-]/g, ""), txt(body.iccid, 40) || null, useType, staff.id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "sim_or_iccid_already_registered" }, 409);
    throw error;
  }
  await audit(env.DB, staff, requestId, "REGISTER_COMPANY_SIM", "SIM_CARD", id, { carrier, msisdn, useType }, "Company asset registry entry created; telco registration evidence must be separately verified");
  return json({ data: { id, carrier, msisdn: msisdn.replace(/[\\s-]/g, ""), useType, companyRegistrationStatus: "PENDING" }, requestId }, 201);
}


async function verifyCompanySimRegistration(request: Request, env: EnterpriseEnv, staff: StaffContext, simId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const evidenceFileId = txt(body.evidenceFileId, 64);
  const reason = txt(body.reason, 300);
  if (!evidenceFileId || !reason) return json({ error: "registration_evidence_and_reason_required" }, 400);
  const sim = await env.DB.prepare("SELECT id,company_registration_status FROM omni_company_sim_cards WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(simId, staff.company_id).first<{id:string;company_registration_status:string}>();
  if (!sim) return json({ error: "sim_not_found" }, 404);
  const evidence = await env.DB.prepare(
    "SELECT id,evidence_type,outlet_id FROM omni_evidence_files WHERE id=?1 AND company_id=?2 AND deleted_at IS NULL LIMIT 1"
  ).bind(evidenceFileId, staff.company_id).first<{id:string;evidence_type:string;outlet_id:string|null}>();
  if (!evidence || evidence.evidence_type !== "STAFF_DOCUMENT" || evidence.outlet_id !== null) {
    return json({ error: "company_sim_registration_document_required", detail: "Upload the telecom company SIM registration evidence as a company-level staff document, not a shop transaction attachment." }, 422);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_company_sim_cards SET company_registration_status='REGISTERED',registration_evidence_id=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND company_id=?3")
      .bind(evidenceFileId, simId, staff.company_id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,after_state,request_id,company_id) VALUES (?1,?2,'VERIFY_COMPANY_SIM_REGISTRATION','SIM_CARD',?3,?4,?5,?6,?7)")
      .bind(uuid(), staff.id, simId, reason, JSON.stringify({ companyRegistrationStatus: "REGISTERED", evidenceFileId }), requestId, staff.company_id)
  ]);
  return json({ data: { id: simId, companyRegistrationStatus: "REGISTERED", evidenceFileId }, requestId });
}

async function registerCompanyDevice(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const assetTag = txt(body.assetTag, 48).toUpperCase();
  const deviceType = txt(body.deviceType, 32);
  const ownership = txt(body.ownershipType, 24) || "COMPANY_OWNED";
  const allowedTypes = ["ANDROID_PHONE","PROVIDER_TERMINAL","TABLET","COMPUTER","PRINTER","SCANNER","ROUTER","OTHER"];
  if (!/^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(assetTag) || !allowedTypes.includes(deviceType) ||
      !["COMPANY_OWNED","LEASED","PROVIDER_ISSUED"].includes(ownership)) {
    return json({ error: "valid_asset_tag_device_type_and_ownership_required" }, 400);
  }
  const id = uuid();
  try {
    await env.DB.prepare(
      "INSERT INTO omni_company_devices (id,company_id,asset_tag,device_type,manufacturer,model,serial_number,imei_1,imei_2,ownership_type,status,managed_device,acquired_at,warranty_until,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'IN_STOCK',?11,?12,?13,?14)"
    ).bind(id, staff.company_id, assetTag, deviceType, txt(body.manufacturer, 80) || null, txt(body.model, 100) || null,
      txt(body.serialNumber, 120) || null, txt(body.imei1, 32) || null, txt(body.imei2, 32) || null, ownership,
      body.managedDevice === true ? 1 : 0, txt(body.acquiredAt, 20) || null, txt(body.warrantyUntil, 20) || null, staff.id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "asset_tag_or_imei_already_registered" }, 409);
    throw error;
  }
  await audit(env.DB, staff, requestId, "REGISTER_COMPANY_DEVICE", "DEVICE", id, { assetTag, deviceType, ownership }, "Company device asset record created");
  return json({ data: { id, assetTag, deviceType, ownership, status: "IN_STOCK" }, requestId }, 201);
}

async function listEnterpriseEmployees(env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  const rows = staff.role === "SOVEREIGN"
    ? await env.DB.prepare("SELECT e.id,e.employee_number,e.legal_name,e.preferred_name,e.department_id,e.job_title,e.employment_type,e.employment_status,e.start_date,e.end_date,e.work_email,e.work_phone,e.created_at,m.display_name,m.email FROM omni_enterprise_employees e JOIN omni_staff_memberships m ON m.id=e.staff_membership_id WHERE e.company_id=?1 ORDER BY e.employee_number").bind(staff.company_id).all()
    : await env.DB.prepare("SELECT DISTINCT e.id,e.employee_number,e.legal_name,e.preferred_name,e.department_id,e.job_title,e.employment_type,e.employment_status,e.start_date,e.end_date,e.work_email,e.work_phone,e.created_at,m.display_name,m.email FROM omni_enterprise_employees e JOIN omni_staff_memberships m ON m.id=e.staff_membership_id JOIN omni_employee_outlet_assignments a ON a.employee_id=e.id JOIN omni_employee_outlet_assignments own_a ON own_a.outlet_id=a.outlet_id JOIN omni_enterprise_employees own_e ON own_e.id=own_a.employee_id WHERE e.company_id=?1 AND own_e.staff_membership_id=?2 AND own_e.company_id=?1 AND own_e.employment_status='ACTIVE' AND own_a.status='ACTIVE' AND a.status='ACTIVE' AND (e.id=own_e.id OR ?3=1) ORDER BY e.employee_number").bind(staff.company_id, staff.id, ["MANAGER","MANAGING_DIRECTOR","CHAIRMAN"].includes(staff.role) ? 1 : 0).all();
  return json({ data: rows.results, requestId });
}


async function createProviderOperatorProfile(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const accountId = txt(body.providerOutletAccountId, 64);
  const employeeId = txt(body.employeeId, 64);
  if (!accountId || !employeeId) return json({ error: "provider_account_and_employee_required" }, 400);
  const scope = await env.DB.prepare(
    "SELECT a.id,a.outlet_id,a.status,r.id AS relationship_id,r.agreement_status,e.id AS employee_id,e.employment_status FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id JOIN omni_enterprise_employees e ON e.id=?1 AND e.company_id=a.company_id WHERE a.id=?2 AND a.company_id=?3 LIMIT 1"
  ).bind(employeeId, accountId, staff.company_id).first<{
    id:string;outlet_id:string;status:string;relationship_id:string;agreement_status:string;employee_id:string;employment_status:string;
  }>();
  if (!scope) return json({ error: "provider_account_or_employee_not_found" }, 404);
  if (scope.status !== "ACTIVE" || scope.agreement_status !== "APPROVED" || scope.employment_status !== "ACTIVE") {
    return json({ error: "active_provider_account_agreement_and_employee_required" }, 409);
  }
  const assignment = await env.DB.prepare(
    "SELECT id FROM omni_employee_outlet_assignments WHERE company_id=?1 AND employee_id=?2 AND outlet_id=?3 AND status='ACTIVE' AND starts_at<=CURRENT_TIMESTAMP AND (ends_at IS NULL OR ends_at>CURRENT_TIMESTAMP) LIMIT 1"
  ).bind(staff.company_id, employeeId, scope.outlet_id).first<{id:string}>();
  if (!assignment) return json({ error: "employee_must_be_assigned_to_provider_outlet" }, 409);
  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO omni_provider_operator_profiles (id,company_id,provider_relationship_id,provider_outlet_account_id,employee_id,provider_operator_id,provider_username,approval_status,created_by) VALUES (?1,?2,?3,?4,?5,?6,?7,'PENDING',?8)"
  ).bind(id, staff.company_id, scope.relationship_id, accountId, employeeId, txt(body.providerOperatorId, 120) || null, txt(body.providerUsername, 120) || null, staff.id).run();
  await audit(env.DB, staff, requestId, "CREATE_PROVIDER_OPERATOR_PROFILE", "PROVIDER_OPERATOR_PROFILE", id, { accountId, employeeId, approvalStatus: "PENDING" }, "Provider-specific teller identity mapping created pending provider approval");
  return json({ data: { id, providerOutletAccountId: accountId, employeeId, approvalStatus: "PENDING" }, requestId }, 201);
}

async function updateProviderOperatorProfile(request: Request, env: EnterpriseEnv, staff: StaffContext, operatorProfileId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const profile = await env.DB.prepare(
    "SELECT p.id,p.approval_status,p.provider_operator_id,p.provider_outlet_account_id,a.status AS account_status,r.agreement_status FROM omni_provider_operator_profiles p JOIN omni_provider_outlet_accounts a ON a.id=p.provider_outlet_account_id AND a.company_id=p.company_id JOIN omni_provider_relationships r ON r.id=p.provider_relationship_id AND r.company_id=p.company_id WHERE p.id=?1 AND p.company_id=?2 LIMIT 1"
  ).bind(operatorProfileId, staff.company_id).first<{
    id:string;approval_status:string;provider_operator_id:string|null;provider_outlet_account_id:string;account_status:string;agreement_status:string;
  }>();
  if (!profile) return json({ error: "operator_profile_not_found" }, 404);
  const status = txt(body.approvalStatus, 20);
  const approvalReference = txt(body.providerApprovalReference, 120);
  const reason = txt(body.reason, 300);
  if (!["TRAINING","APPROVED","SUSPENDED","REVOKED"].includes(status) || !reason) return json({ error: "valid_status_and_reason_required" }, 400);
  if (status === "APPROVED" && (profile.account_status !== "ACTIVE" || profile.agreement_status !== "APPROVED" || !approvalReference)) {
    return json({ error: "active_approved_provider_account_and_provider_approval_reference_required" }, 409);
  }
  const providerOperatorId = txt(body.providerOperatorId, 120) || profile.provider_operator_id;
  if (status === "APPROVED" && !providerOperatorId) return json({ error: "provider_operator_id_required" }, 422);
  await env.DB.batch([
    env.DB.prepare("UPDATE omni_provider_operator_profiles SET approval_status=?1,provider_operator_id=?2,approved_reference=COALESCE(?3,approved_reference),approved_at=CASE WHEN ?1='APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,revoked_at=CASE WHEN ?1='REVOKED' THEN CURRENT_TIMESTAMP ELSE revoked_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND company_id=?5")
      .bind(status, providerOperatorId, approvalReference || null, operatorProfileId, staff.company_id),
    env.DB.prepare("INSERT INTO omni_audit_events (id,actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id,company_id) VALUES (?1,?2,'UPDATE_PROVIDER_OPERATOR_PROFILE','PROVIDER_OPERATOR_PROFILE',?3,?4,?5,?6,?7,?8)")
      .bind(uuid(), staff.id, operatorProfileId, reason, JSON.stringify({ approvalStatus: profile.approval_status }), JSON.stringify({ approvalStatus: status, providerOperatorId, approvalReference }), requestId, staff.company_id)
  ]);
  return json({ data: { id: operatorProfileId, approvalStatus: status, providerOperatorId, approvalReference: approvalReference || null }, requestId });
}

async function assignCompanySim(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const simId = txt(body.simCardId, 64);
  const outletId = txt(body.outletId, 64);
  const employeeId = txt(body.employeeId, 64) || null;
  const providerAccountId = txt(body.providerOutletAccountId, 64) || null;
  if (!simId || !outletId) return json({ error: "sim_card_and_outlet_required" }, 400);
  const sim = await env.DB.prepare("SELECT id,carrier,use_type,company_registration_status,status FROM omni_company_sim_cards WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(simId, staff.company_id).first<{id:string;carrier:string;use_type:string;company_registration_status:string;status:string}>();
  if (!sim || sim.status !== "IN_STOCK") return json({ error: "sim_not_available" }, 409);
  const outlet = await env.DB.prepare("SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(outletId, staff.company_id).first<{id:string;status:string}>();
  if (!outlet || outlet.status !== "ACTIVE") return json({ error: "active_outlet_required" }, 409);
  if (sim.use_type === "AGENCY_OPERATION" && sim.company_registration_status !== "REGISTERED") {
    return json({ error: "company_registered_sim_required_for_agency_operation" }, 409);
  }
  if (employeeId) {
    const assignment = await env.DB.prepare("SELECT id FROM omni_employee_outlet_assignments WHERE company_id=?1 AND employee_id=?2 AND outlet_id=?3 AND status='ACTIVE' LIMIT 1")
      .bind(staff.company_id, employeeId, outletId).first<{id:string}>();
    if (!assignment) return json({ error: "employee_not_assigned_to_outlet" }, 409);
  }
  if (providerAccountId) {
    const account = await env.DB.prepare("SELECT a.id,r.provider FROM omni_provider_outlet_accounts a JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id WHERE a.id=?1 AND a.company_id=?2 AND a.outlet_id=?3 AND a.status='ACTIVE' LIMIT 1")
      .bind(providerAccountId, staff.company_id, outletId).first<{id:string;provider:string}>();
    if (!account) return json({ error: "provider_account_not_active_at_outlet" }, 409);
    if ((account.provider === "AIRTEL_MONEY" && sim.carrier !== "AIRTEL") || (account.provider === "MTN_MOMO" && sim.carrier !== "MTN")) {
      return json({ error: "sim_carrier_does_not_match_provider_account" }, 409);
    }
  }
  const id = uuid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO omni_sim_assignments (id,company_id,sim_card_id,employee_id,outlet_id,provider_outlet_account_id,starts_at,issued_by,status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ACTIVE')")
      .bind(id, staff.company_id, simId, employeeId, outletId, providerAccountId, new Date().toISOString(), staff.id),
    env.DB.prepare("UPDATE omni_company_sim_cards SET status='ASSIGNED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND company_id=?2")
      .bind(simId, staff.company_id)
  ]);
  await audit(env.DB, staff, requestId, "ASSIGN_COMPANY_SIM", "SIM_ASSIGNMENT", id, { simId, employeeId, outletId, providerAccountId }, "Company SIM assigned to an outlet/employee");
  return json({ data: { id, simCardId: simId, employeeId, outletId, status: "ACTIVE" }, requestId }, 201);
}

async function assignCompanyDevice(request: Request, env: EnterpriseEnv, staff: StaffContext, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const deviceId = txt(body.deviceId, 64);
  const outletId = txt(body.outletId, 64);
  const employeeId = txt(body.employeeId, 64) || null;
  if (!deviceId || !outletId) return json({ error: "device_and_outlet_required" }, 400);
  const device = await env.DB.prepare("SELECT id,status FROM omni_company_devices WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(deviceId, staff.company_id).first<{id:string;status:string}>();
  if (!device || device.status !== "IN_STOCK") return json({ error: "device_not_available" }, 409);
  const outlet = await env.DB.prepare("SELECT id,status FROM omni_enterprise_outlets WHERE id=?1 AND company_id=?2 LIMIT 1")
    .bind(outletId, staff.company_id).first<{id:string;status:string}>();
  if (!outlet || outlet.status !== "ACTIVE") return json({ error: "active_outlet_required" }, 409);
  if (employeeId) {
    const assignment = await env.DB.prepare("SELECT id FROM omni_employee_outlet_assignments WHERE company_id=?1 AND employee_id=?2 AND outlet_id=?3 AND status='ACTIVE' LIMIT 1")
      .bind(staff.company_id, employeeId, outletId).first<{id:string}>();
    if (!assignment) return json({ error: "employee_not_assigned_to_outlet" }, 409);
  }
  const id = uuid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO omni_device_assignments (id,company_id,device_id,employee_id,outlet_id,issued_at,issued_by,status) VALUES (?1,?2,?3,?4,?5,?6,?7,'ACTIVE')")
      .bind(id, staff.company_id, deviceId, employeeId, outletId, new Date().toISOString(), staff.id),
    env.DB.prepare("UPDATE omni_company_devices SET status='ASSIGNED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND company_id=?2")
      .bind(deviceId, staff.company_id)
  ]);
  await audit(env.DB, staff, requestId, "ASSIGN_COMPANY_DEVICE", "DEVICE_ASSIGNMENT", id, { deviceId, employeeId, outletId }, "Company device assigned to an outlet/employee");
  return json({ data: { id, deviceId, employeeId, outletId, status: "ACTIVE" }, requestId }, 201);
}

async function returnCompanyAsset(request: Request, env: EnterpriseEnv, staff: StaffContext, assetType: "SIM" | "DEVICE", assignmentId: string, requestId: string) {
  if (staff.role !== "SOVEREIGN") return json({ error: "forbidden" }, 403);
  const body = await bodyJson(request); if (isResponse(body)) return body;
  const condition = txt(body.returnCondition, 120);
  const reason = txt(body.reason, 300);
  if (!condition || !reason) return json({ error: "return_condition_and_reason_required" }, 400);
  const isSim = assetType === "SIM";
  const table = isSim ? "omni_sim_assignments" : "omni_device_assignments";
  const assetField = isSim ? "sim_card_id" : "device_id";
  const assetsTable = isSim ? "omni_company_sim_cards" : "omni_company_devices";
  const assignment = await env.DB.prepare(
    "SELECT id," + assetField + " AS asset_id,status FROM " + table + " WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(assignmentId, staff.company_id).first<{id:string;asset_id:string;status:string}>();
  if (!assignment || assignment.status !== "ACTIVE") return json({ error: "active_asset_assignment_not_found" }, 404);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE " + table + " SET status='RETURNED'," + (isSim ? "ends_at" : "returned_at") + "=?1,returned_to=?2,return_condition=?3 WHERE id=?4 AND company_id=?5")
      .bind(now, staff.id, condition, assignmentId, staff.company_id),
    env.DB.prepare("UPDATE " + assetsTable + " SET status='IN_STOCK',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND company_id=?2")
      .bind(assignment.asset_id, staff.company_id)
  ]);
  await audit(env.DB, staff, requestId, "RETURN_COMPANY_ASSET", assetType, assignment.asset_id, { assignmentId, condition }, reason);
  return json({ data: { assignmentId, assetId: assignment.asset_id, status: "RETURNED", returnedAt: now, returnCondition: condition }, requestId });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char] || char);
}

function printReceiptHtml(receiptNumber: string, content: Record<string, unknown>): string {
  const company = (content.company && typeof content.company === "object" ? content.company : {}) as Record<string, unknown>;
  const outlet = (content.outlet && typeof content.outlet === "object" ? content.outlet : {}) as Record<string, unknown>;
  const items = Array.isArray(content.items) ? content.items as Record<string, unknown>[] : [];
  const agency = content.receiptType === "AGENCY_SERVICE_ACKNOWLEDGEMENT";
  const amount = Number(content.amountUgx ?? content.totalUgx ?? 0);
  const lines = agency
    ? [["Provider", content.provider], ["Reference", content.providerReference], ["Service", content.transactionType], ["Status source", content.sourceStatus], ["Record review", content.verificationLevel]].map(([key,value]) => "<tr><th>" + escapeHtml(key) + "</th><td>" + escapeHtml(value) + "</td></tr>").join("")
    : items.map(item => "<tr><td>" + escapeHtml(item.name) + "</td><td>" + escapeHtml(item.sku) + "</td><td>" + escapeHtml(item.quantity) + "</td><td>" + escapeHtml(item.unitPriceUgx) + "</td><td>" + escapeHtml(item.lineTotalUgx) + "</td></tr>").join("");
  const retailHead = "<tr><th>Item</th><th>SKU</th><th>Qty</th><th>Unit price (UGX)</th><th>Total (UGX)</th></tr>";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + escapeHtml(receiptNumber) + "</title><style>" +
    "@page{size:auto;margin:10mm}body{font-family:Arial,sans-serif;color:#111;margin:0;padding:20px;max-width:760px;margin:auto}.muted{color:#555;font-size:12px}.top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:14px}h1{font-size:20px;margin:0 0 6px}.number{font-size:13px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}th{background:#f4f4f4}.total{font-size:18px;font-weight:bold;text-align:right;margin-top:18px}.notice{margin-top:20px;padding:10px;border:1px solid #bbb;font-size:12px}.actions{margin:14px 0}@media print{.actions{display:none}body{padding:0}}" +
    "</style></head><body><div class=\"top\"><div><h1>" + escapeHtml(company.legalName || company.tradingName || "Company receipt") + "</h1><div class=\"muted\">" + escapeHtml(company.tradingName || "") + "</div><div class=\"muted\">" + escapeHtml(outlet.name || "") + " · " + escapeHtml(outlet.address || "") + "</div><div class=\"muted\">TIN: " + escapeHtml(company.tin || "Not configured") + "</div></div><div class=\"number\">RECEIPT<br>" + escapeHtml(receiptNumber) + "<br><span class=\"muted\">" + escapeHtml(content.issuedAt || "") + "</span></div></div>" +
    "<table>" + (agency ? lines : retailHead + lines) + "</table>" +
    "<div class=\"total\">Total: UGX " + escapeHtml(amount.toLocaleString("en-UG")) + "</div>" +
    "<div class=\"notice\">" + escapeHtml(content.disclaimer || "") + "</div>" +
    "<div class=\"actions\"><button onclick=\"window.print()\">Print / Save as PDF</button></div></body></html>";
}

async function printReceipt(request: Request, env: EnterpriseEnv, staff: StaffContext, receiptId: string) {
  const receipt = await env.DB.prepare(
    "SELECT id,outlet_id,receipt_number,content_snapshot_json FROM omni_receipt_documents WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(receiptId, staff.company_id).first<{id:string;outlet_id:string;receipt_number:string;content_snapshot_json:string}>();
  if (!receipt) return json({ error: "receipt_not_found" }, 404);
  if (!(await hasOutletAccess(env.DB, staff, receipt.outlet_id))) return json({ error: "outlet_access_denied" }, 403);
  let content: Record<string, unknown>;
  try { content = JSON.parse(receipt.content_snapshot_json) as Record<string, unknown>; }
  catch { return json({ error: "receipt_snapshot_invalid" }, 500); }
  return new Response(printReceiptHtml(receipt.receipt_number, content), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

async function getReceipt(request: Request, env: EnterpriseEnv, staff: StaffContext, receiptId: string, requestId: string) {
  const receipt = await env.DB.prepare(
    "SELECT id,outlet_id,receipt_number,receipt_type,source_type,source_id,provider,provider_reference,verification_label,receipt_status,currency,total_ugx,content_snapshot_json,customer_disclaimer,issued_by,issued_at FROM omni_receipt_documents WHERE id=?1 AND company_id=?2 LIMIT 1"
  ).bind(receiptId, staff.company_id).first<{ id: string; outlet_id: string; content_snapshot_json: string; [key: string]: unknown }>();
  if (!receipt) return json({ error: "receipt_not_found" }, 404);
  if (!(await hasOutletAccess(env.DB, staff, receipt.outlet_id))) return json({ error: "outlet_access_denied" }, 403);
  let content: unknown = null;
  try { content = JSON.parse(receipt.content_snapshot_json); } catch { return json({ error: "receipt_snapshot_invalid" }, 500); }
  const { content_snapshot_json: _snapshot, ...metadata } = receipt;
  return json({ data: { ...metadata, content, pdfReady: false }, requestId });
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
  if (request.method === "POST" && url.pathname === "/api/v1/employees") return createEmployee(request, env, staff, requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/employees") return listEnterpriseEmployees(env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/employee-outlet-assignments") return assignEmployeeToOutlet(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/company-sims") return registerCompanySim(request, env, staff, requestId);
  const simRegistrationMatch = url.pathname.match(/^\/api\/v1\/company-sims\/([^/]+)\/registration$/);
  if (request.method === "PATCH" && simRegistrationMatch) return verifyCompanySimRegistration(request, env, staff, txt(simRegistrationMatch[1],64), requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/company-devices") return registerCompanyDevice(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/provider-operator-profiles") return createProviderOperatorProfile(request, env, staff, requestId);
  const operatorProfileMatch = url.pathname.match(/^\/api\/v1\/provider-operator-profiles\/([^/]+)$/);
  if (request.method === "PATCH" && operatorProfileMatch) return updateProviderOperatorProfile(request, env, staff, txt(operatorProfileMatch[1], 64), requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/sim-assignments") return assignCompanySim(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/device-assignments") return assignCompanyDevice(request, env, staff, requestId);
  const simReturnMatch = url.pathname.match(/^\/api\/v1\/sim-assignments\/([^/]+)\/return$/);
  if (request.method === "POST" && simReturnMatch) return returnCompanyAsset(request, env, staff, "SIM", txt(simReturnMatch[1],64), requestId);
  const deviceReturnMatch = url.pathname.match(/^\/api\/v1\/device-assignments\/([^/]+)\/return$/);
  if (request.method === "POST" && deviceReturnMatch) return returnCompanyAsset(request, env, staff, "DEVICE", txt(deviceReturnMatch[1],64), requestId);
  const outletStatusMatch = url.pathname.match(/^\/api\/v1\/outlets\/([^/]+)\/status$/);
  if (request.method === "PATCH" && outletStatusMatch) return updateOutletStatus(request, env, staff, txt(outletStatusMatch[1], 64), requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/company-profile") return getCompanyProfile(env, staff, requestId);
  if (request.method === "PUT" && url.pathname === "/api/v1/company-profile") return saveCompanyProfile(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/provider-relationships") return createProviderRelationship(request, env, staff, requestId);
  const relationshipStatusMatch = url.pathname.match(/^\/api\/v1\/provider-relationships\/([^/]+)$/);
  if (request.method === "PATCH" && relationshipStatusMatch) return updateProviderRelationship(request, env, staff, txt(relationshipStatusMatch[1], 64), requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/provider-outlet-accounts") return createProviderOutletAccount(request, env, staff, requestId);
  const providerAccountStatusMatch = url.pathname.match(/^\/api\/v1\/provider-outlet-accounts\/([^/]+)$/);
  if (request.method === "PATCH" && providerAccountStatusMatch) return updateProviderOutletAccount(request, env, staff, txt(providerAccountStatusMatch[1], 64), requestId);
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
  if (request.method === "POST" && url.pathname === "/api/v1/provider-balances") return recordProviderBalance(request, env, staff, requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/provider-balances") return listProviderBalances(request, env, staff, false);
  if (request.method === "GET" && url.pathname === "/api/v1/provider-balances/summary") return listProviderBalances(request, env, staff, true);
  if (request.method === "POST" && url.pathname === "/api/v1/evidence-files") return uploadEvidenceFile(request, env, staff, requestId);
  const evidenceFileMatch = url.pathname.match(/^\/api\/v1\/evidence-files\/([^/]+)$/);
  if (request.method === "GET" && evidenceFileMatch) return downloadEvidenceFile(request, env, staff, txt(evidenceFileMatch[1], 64));
  if (request.method === "POST" && url.pathname === "/api/v1/transaction-evidence/text") return submitTextEvidence(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/agency-receipts") return createAgencyReceipt(request, env, staff, requestId);
  if (request.method === "POST" && url.pathname === "/api/v1/retail-receipts") return createRetailReceipt(request, env, staff, requestId);
  const printReceiptMatch = url.pathname.match(/^\/api\/v1\/receipts\/([^/]+)\/print$/);
  if (request.method === "GET" && printReceiptMatch) return printReceipt(request, env, staff, txt(printReceiptMatch[1], 64));
  const receiptMatch = url.pathname.match(/^\/api\/v1\/receipts\/([^/]+)$/);
  if (request.method === "GET" && receiptMatch) return getReceipt(request, env, staff, txt(receiptMatch[1], 64), requestId);
  if (request.method === "GET" && url.pathname === "/api/v1/transaction-evidence") return listTextEvidence(request, env, staff);
  const reviewMatch = url.pathname.match(/^\/api\/v1\/transaction-evidence\/([^/]+)\/review$/);
  if (request.method === "POST" && reviewMatch) return reviewTextEvidence(request, env, staff, txt(reviewMatch[1], 64), requestId);
  return null;
}

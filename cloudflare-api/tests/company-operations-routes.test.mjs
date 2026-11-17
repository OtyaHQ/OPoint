import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Miniflare } from "miniflare";

const migrationsDir = new URL("../migrations/", import.meta.url);
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace("./providers/quickteller-business-sandbox", "./quickteller-business-sandbox.mjs");
const tempDir = mkdtempSync(join(tmpdir(), "otyapoint-company-operations-routes-"));
const providerSource = readFileSync(new URL("../src/providers/quickteller-business-sandbox.ts", import.meta.url), "utf8");
const compiledProvider = ts.transpileModule(providerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
writeFileSync(join(tempDir, "quickteller-business-sandbox.mjs"), compiledProvider);
writeFileSync(join(tempDir, "index.mjs"), compiled);
copyFileSync(new URL("../src/sale-fingerprint.mjs", import.meta.url), join(tempDir, "sale-fingerprint.mjs"));
const worker = (await import(pathToFileURL(join(tempDir, "index.mjs")).href)).default;

const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('test runtime'); } };",
  compatibilityDate: "2026-08-06",
  d1Databases: { DB: "otyapoint-company-operations-routes" }
});
const db = await mf.getD1Database("DB");

async function run(sql, ...values) {
  return db.prepare(sql).bind(...values).run();
}
async function first(sql, ...values) {
  return db.prepare(sql).bind(...values).first();
}
async function applyMigrations() {
  const migrations = readdirSync(new URL("../migrations/", import.meta.url))
    .filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(migrations.at(-1), "0010_company_operations_level_1_2.sql");
  for (const name of migrations) {
    const sql = readFileSync(new URL(name, migrationsDir), "utf8")
      .replace(/^[ \t]*--[^\n]*(?:\n|$)/gm, "");
    await db.exec(sql.replace(/\s*\n\s*/g, " "));
  }
}
await applyMigrations();
await run("INSERT INTO omni_branches (id,company_id,branch_code,name,status,is_primary) VALUES ('branch-a','company-a','MAIN','Main Shop','ACTIVE',1)");
await run("INSERT INTO omni_staff_memberships (id,identity_subject,company_id,branch_id,role,status,display_name,email) VALUES ('owner-a','identity-owner','company-a','branch-a','SOVEREIGN','ACTIVE','Synthetic Owner','owner@example.invalid')");
await run("INSERT INTO omni_staff_memberships (id,identity_subject,company_id,branch_id,role,status,display_name,email) VALUES ('worker-a','identity-worker','company-a','branch-a','ATTENDANT','ACTIVE','Synthetic Worker','worker@example.invalid')");

const env = {
  DB: db,
  AUTH: {
    async fetch(request) {
      const token = request.headers.get("authorization");
      if (token === "Bearer owner-token") return Response.json({ ok: true, user_id: "identity-owner", email: "owner@example.invalid" });
      if (token === "Bearer worker-token") return Response.json({ ok: true, user_id: "identity-worker", email: "worker@example.invalid" });
      if (token === "Bearer mobile-token") return Response.json({ ok: true, user_id: "identity-mobile", email: "mobile@example.invalid" });
      return Response.json({ ok: false }, { status: 401 });
    }
  }
};

async function call(path, options = {}) {
  const token = options.token || "owner-token";
  const method = options.method || "GET";
  const body = options.body;
  const headers = { authorization: "Bearer " + token, "cf-ray": "company-ops-" + crypto.randomUUID() };
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(new Request("https://otyapoint.test" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

test("owner can create company branches and a second primary branch is rejected", async () => {
  const created = await call("/api/branches", {
    method: "POST",
    body: { branchCode: "SECOND", name: "Second Shop", townCouncil: "Mbirizi", isPrimary: false }
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.data.branchCode, "SECOND");
  assert.equal(createdBody.data.isPrimary, false);

  const conflict = await call("/api/branches", {
    method: "POST",
    body: { branchCode: "THIRD", name: "Third Shop", isPrimary: true }
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "primary_branch_already_exists");
});

test("ordinary staff cannot create branches or manage staff work assignments", async () => {
  const branchResponse = await call("/api/branches", {
    token: "worker-token", method: "POST",
    body: { branchCode: "NOPE", name: "Unauthorised Branch" }
  });
  assert.equal(branchResponse.status, 403);

  const assignmentResponse = await call("/api/staff/work-assignments", {
    token: "worker-token", method: "POST",
    body: { staffMembershipId: "worker-a", branchId: "branch-a", workArea: "MOBILE_MONEY", dutyRole: "OPERATOR" }
  });
  assert.equal(assignmentResponse.status, 403);
});

test("one worker can hold distinct Retail and Mobile Money duties at the same branch", async () => {
  const retail = await call("/api/staff/work-assignments", {
    method: "POST",
    body: { staffMembershipId: "worker-a", branchId: "branch-a", workArea: "RETAIL", dutyRole: "OPERATOR" }
  });
  assert.equal(retail.status, 201, await retail.text());

  const mobileMoney = await call("/api/staff/work-assignments", {
    method: "POST",
    body: { staffMembershipId: "worker-a", branchId: "branch-a", workArea: "MOBILE_MONEY", dutyRole: "SUPERVISOR" }
  });
  assert.equal(mobileMoney.status, 201, await mobileMoney.text());

  const assignments = await call("/api/staff/work-assignments");
  assert.equal(assignments.status, 200);
  const rows = (await assignments.json()).data;
  assert.deepEqual(
    rows.map(row => [row.work_area, row.duty_role]).sort(),
    [["MOBILE_MONEY", "SUPERVISOR"], ["RETAIL", "OPERATOR"]]
  );

  const duplicate = await call("/api/staff/work-assignments", {
    method: "POST",
    body: { staffMembershipId: "worker-a", branchId: "branch-a", workArea: "RETAIL", dutyRole: "APPROVER" }
  });
  assert.equal(duplicate.status, 409);
});

test("Retail and Mobile Money assignments separate stock, sales and agency views", async () => {
  const created = await call("/api/products", {
    method: "POST",
    body: {
      sku: "BRANCH-ITEM-01",
      name: "Branch-scoped test item",
      category: "Accessories",
      costPrice: 100,
      sellingPrice: 200,
      reorderLevel: 2
    }
  });
  assert.equal(created.status, 201, await created.text());
  const productId = (await created.json()).data.id;

  const opening = await call("/api/branch-stock/opening", {
    method: "POST",
    body: {
      branchId: "branch-a",
      productId,
      quantity: 10,
      reason: "Owner verified opening count",
      idempotencyKey: "branch-opening-0001"
    }
  });
  assert.equal(opening.status, 201, await opening.text());

  await run(
    "INSERT INTO omni_staff_memberships (id,identity_subject,company_id,branch_id,role,status,display_name,email) VALUES ('mobile-only','identity-mobile','company-a','branch-a','ATTENDANT','ACTIVE','Mobile Agent','mobile@example.invalid')"
  );
  const mobileAssignment = await call("/api/staff/work-assignments", {
    method: "POST",
    body: {
      staffMembershipId: "mobile-only",
      branchId: "branch-a",
      workArea: "MOBILE_MONEY",
      dutyRole: "OPERATOR"
    }
  });
  assert.equal(mobileAssignment.status, 201, await mobileAssignment.text());

  const retailProducts = await call("/api/products", { token: "worker-token" });
  assert.equal(retailProducts.status, 200, await retailProducts.text());
  const visibleProduct = (await retailProducts.json()).data.find(row => row.id === productId);
  assert.equal(visibleProduct.quantity_on_hand, 10);

  const mobileProducts = await call("/api/products", { token: "mobile-token" });
  assert.equal(mobileProducts.status, 403);
  assert.equal((await mobileProducts.json()).error, "work_area_assignment_required");

  const mobileRetailSale = await call("/api/sales", {
    token: "mobile-token",
    method: "POST",
    body: { branchId: "branch-a", paymentMethod: "CASH", items: [{ productId, quantity: 1 }] }
  });
  assert.equal(mobileRetailSale.status, 403);
  assert.equal((await mobileRetailSale.json()).error, "work_area_assignment_required");

  const retailSale = await call("/api/sales", {
    token: "worker-token",
    method: "POST",
    body: { branchId: "branch-a", paymentMethod: "CASH", items: [{ productId, quantity: 1 }] },
  });
  assert.equal(retailSale.status, 201, await retailSale.text());
  const result = await retailSale.json();
  assert.equal(result.data.branchId, "branch-a");

  const stock = await call("/api/branch-stock", { token: "worker-token" });
  assert.equal(stock.status, 200, await stock.text());
  const updated = (await stock.json()).data.find(row => row.product_id === productId);
  assert.equal(updated.quantity_on_hand, 9);

  const mobileAgency = await call("/api/agency-overview", { token: "mobile-token" });
  assert.equal(mobileAgency.status, 200, await mobileAgency.text());
  assert.equal((await mobileAgency.json()).branchId, "branch-a");
});

test("work assignment cannot cross company or branch membership boundaries", async () => {
  const secondBranch = await call("/api/branches", {
    method: "POST",
    body: { branchCode: "OTHER", name: "Other Branch", isPrimary: false }
  });
  assert.equal(secondBranch.status, 201);
  const otherBranchId = (await secondBranch.json()).data.id;

  const wrongBranch = await call("/api/staff/work-assignments", {
    method: "POST",
    body: { staffMembershipId: "worker-a", branchId: otherBranchId, workArea: "RETAIL", dutyRole: "OPERATOR" }
  });
  assert.equal(wrongBranch.status, 409);
  assert.equal((await wrongBranch.json()).error, "staff_or_branch_not_available_for_assignment");

  const created = await first("SELECT COUNT(*) AS count FROM omni_staff_work_assignments WHERE staff_membership_id='worker-a'");
  assert.equal(Number(created.count), 2);
});

test("owner can suspend and revoke an assignment; revoked access cannot be reactivated", async () => {
  const current = await first("SELECT id FROM omni_staff_work_assignments WHERE staff_membership_id='worker-a' AND work_area='RETAIL'");
  const suspended = await call("/api/staff/work-assignments/" + current.id, {
    method: "PATCH", body: { status: "SUSPENDED" }
  });
  assert.equal(suspended.status, 200);

  const revoked = await call("/api/staff/work-assignments/" + current.id, {
    method: "PATCH", body: { status: "REVOKED" }
  });
  assert.equal(revoked.status, 200);

  const reactivated = await call("/api/staff/work-assignments/" + current.id, {
    method: "PATCH", body: { status: "ACTIVE" }
  });
  assert.equal(reactivated.status, 409);
});

test("ordinary staff can only see branches they belong to or have active work assignment in", async () => {
  const branchResponse = await call("/api/branches", { token: "worker-token" });
  assert.equal(branchResponse.status, 200);
  const rows = (await branchResponse.json()).data;
  assert.deepEqual(rows.map(row => row.id), ["branch-a"]);
});

test("branch and work assignment changes are audited", async () => {
  const count = await first("SELECT COUNT(*) AS count FROM omni_audit_events WHERE company_id='company-a' AND action IN ('CREATE_BRANCH','CREATE_WORK_ASSIGNMENT','UPDATE_WORK_ASSIGNMENT')");
  assert.equal(Number(count.count), 6);
});

test.after(async () => {
  await mf.dispose();
  rmSync(tempDir, { recursive: true, force: true });
});

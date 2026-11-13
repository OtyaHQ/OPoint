import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "otya-permission-test-"));
const source = readFileSync(new URL("../src/authorization.d.mts", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../src/authorization.mjs", import.meta.url), "utf8");
writeFileSync(join(tempDir, "authorization.mjs"), runtimeSource);
const { findPermissionScope, hasPermission } = await import(pathToFileURL(join(tempDir, "authorization.mjs")).href);

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              calls.push({ sql, values });
              return row;
            }
          };
        }
      };
    }
  };
}

const principal = { id: "staff-42", company_id: "company-9" };
const now = "2026-11-13T10:00:00.000Z";

test("company-wide grant is looked up for the exact company, employee and permission", async () => {
  const db = fakeDb({ scope_type: "COMPANY", scope_id: null });
  const scope = await findPermissionScope(db, principal, "retail.sell", { now });
  assert.deepEqual(scope, { scope_type: "COMPANY", scope_id: null });
  assert.deepEqual(db.calls[0].values, ["company-9", "staff-42", "retail.sell", "", "", now]);
  assert.match(db.calls[0].sql, /g\.company_id = \?1/);
  assert.match(db.calls[0].sql, /g\.staff_membership_id = \?2/);
});

test("outlet-scoped authorization binds the selected outlet and checks the active employee assignment", async () => {
  const db = fakeDb({ scope_type: "OUTLET", scope_id: "outlet-1" });
  const scope = await findPermissionScope(db, principal, "retail.sell", { outletId: "outlet-1", now });
  assert.deepEqual(scope, { scope_type: "OUTLET", scope_id: "outlet-1" });
  assert.equal(db.calls[0].values[3], "outlet-1");
  assert.match(db.calls[0].sql, /e\.employment_status='ACTIVE'/);
  assert.match(db.calls[0].sql, /a\.status='ACTIVE'/);
  assert.match(db.calls[0].sql, /o\.status='ACTIVE'/);
});

test("provider-account authorization requires an approved operator and provider agreement", async () => {
  const db = fakeDb({ scope_type: "PROVIDER_ACCOUNT", scope_id: "airtel-account-1" });
  const scope = await findPermissionScope(db, principal, "providers.operate", { providerAccountId: "airtel-account-1", now });
  assert.deepEqual(scope, { scope_type: "PROVIDER_ACCOUNT", scope_id: "airtel-account-1" });
  assert.equal(db.calls[0].values[4], "airtel-account-1");
  assert.match(db.calls[0].sql, /p\.approval_status='APPROVED'/);
  assert.match(db.calls[0].sql, /r\.agreement_status='APPROVED'/);
  assert.match(db.calls[0].sql, /a\.status='ACTIVE'/);
});

test("self-scoped permissions cannot be used to request another employee's records", async () => {
  const db = fakeDb({ scope_type: "SELF", scope_id: principal.id });
  assert.equal(await hasPermission(db, principal, "staff.read.assigned", { now }), true);
  assert.match(db.calls[0].sql, /g\.scope_type = 'SELF' AND g\.scope_id = \?2/);
});

test("missing grants deny access by default", async () => {
  const db = fakeDb(null);
  assert.equal(await hasPermission(db, principal, "retail.sell", { outletId: "outlet-1", now }), false);
});

test("missing staff identity denies access without a database query", async () => {
  const db = fakeDb({ scope_type: "COMPANY", scope_id: null });
  assert.equal(await hasPermission(db, { id: "", company_id: "" }, "retail.sell", { now }), false);
  assert.equal(db.calls.length, 0);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

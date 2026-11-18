import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentMatchesScope,
  canManageWorkAssignments,
  canPerformWorkAreaWrite,
  isPrivilegedCompanyRole,
  normalizeAssignmentStatus,
  normalizeWorkAssignment,
} from "../src/work-assignments.mjs";

test("normalizes Retail and Mobile Money assignments independently", () => {
  const retail = normalizeWorkAssignment({
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "retail",
    dutyRole: "operator",
    reason: "Retail counter duty",
  });
  const mobile = normalizeWorkAssignment({
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "mobile_money",
    dutyRole: "supervisor",
    reason: "Agency counter duty",
  });
  assert.deepEqual(retail.value, {
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "RETAIL",
    dutyRole: "OPERATOR",
    reason: "Retail counter duty",
  });
  assert.equal(mobile.value.workArea, "MOBILE_MONEY");
  assert.equal(mobile.value.dutyRole, "SUPERVISOR");
});

test("rejects invalid work areas, duty roles and missing reason", () => {
  const base = {
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "BANKING",
    dutyRole: "OPERATOR",
    reason: "A reason",
  };
  assert.equal(normalizeWorkAssignment(base).error, "invalid_work_area");
  assert.equal(normalizeWorkAssignment({ ...base, workArea: "RETAIL", dutyRole: "ROOT" }).error, "invalid_duty_role");
  assert.equal(normalizeWorkAssignment({ ...base, workArea: "RETAIL", reason: "no" }).error, "reason_required");
});

test("only owner and admin can administer work assignments", () => {
  assert.equal(canManageWorkAssignments("OWNER"), true);
  assert.equal(canManageWorkAssignments("ADMIN"), true);
  assert.equal(canManageWorkAssignments("MANAGER"), false);
  assert.equal(isPrivilegedCompanyRole("AGENT"), false);
});

test("work-area access is exact to company, member, branch and active assignment", () => {
  const assignment = {
    company_id: "company-1",
    staff_membership_id: "staff-1",
    branch_id: "branch-1",
    work_area: "MOBILE_MONEY",
    duty_role: "OPERATOR",
    status: "ACTIVE",
  };
  assert.equal(assignmentMatchesScope(assignment, {
    companyId: "company-1",
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "MOBILE_MONEY",
  }), true);
  assert.equal(assignmentMatchesScope(assignment, {
    companyId: "company-1",
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "RETAIL",
  }), false);
  assert.equal(assignmentMatchesScope({ ...assignment, status: "REVOKED" }, {
    companyId: "company-1",
    staffMembershipId: "staff-1",
    branchId: "branch-1",
    workArea: "MOBILE_MONEY",
  }), false);
});

test("viewers can read but cannot perform operator actions", () => {
  assert.equal(canPerformWorkAreaWrite({ status: "ACTIVE", duty_role: "VIEWER" }), false);
  assert.equal(canPerformWorkAreaWrite({ status: "ACTIVE", duty_role: "OPERATOR" }), true);
  assert.equal(canPerformWorkAreaWrite({ status: "SUSPENDED", duty_role: "SUPERVISOR" }), false);
});

test("assignment status changes require a supported status and reason", () => {
  assert.deepEqual(normalizeAssignmentStatus({ status: "suspended", reason: "Shift change" }).value, {
    status: "SUSPENDED",
    reason: "Shift change",
  });
  assert.equal(normalizeAssignmentStatus({ status: "DELETED", reason: "Cleanup" }).error, "invalid_assignment_status");
  assert.equal(normalizeAssignmentStatus({ status: "REVOKED", reason: "no" }).error, "reason_required");
});

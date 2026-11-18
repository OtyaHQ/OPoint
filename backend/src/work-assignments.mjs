export const WORK_AREAS = Object.freeze(["RETAIL", "MOBILE_MONEY"]);
export const WORK_DUTY_ROLES = Object.freeze(["OPERATOR", "SUPERVISOR", "APPROVER", "VIEWER"]);
export const PRIVILEGED_COMPANY_ROLES = Object.freeze(["OWNER", "ADMIN"]);

const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
  : "";

export function normalizeWorkAssignment(body) {
  const staffMembershipId = clean(body?.staffMembershipId, 80);
  const branchId = clean(body?.branchId, 80);
  const workArea = clean(body?.workArea, 24).toUpperCase();
  const dutyRole = clean(body?.dutyRole, 24).toUpperCase();
  const reason = clean(body?.reason, 300);

  if (!staffMembershipId) return { error: "staff_membership_required" };
  if (!branchId) return { error: "branch_required" };
  if (!WORK_AREAS.includes(workArea)) return { error: "invalid_work_area" };
  if (!WORK_DUTY_ROLES.includes(dutyRole)) return { error: "invalid_duty_role" };
  if (reason.length < 4) return { error: "reason_required" };

  return {
    value: { staffMembershipId, branchId, workArea, dutyRole, reason },
  };
}

export function normalizeAssignmentStatus(body) {
  const status = clean(body?.status, 24).toUpperCase();
  const reason = clean(body?.reason, 300);
  if (!["ACTIVE", "SUSPENDED", "REVOKED"].includes(status)) return { error: "invalid_assignment_status" };
  if (reason.length < 4) return { error: "reason_required" };
  return { value: { status, reason } };
}

export function isPrivilegedCompanyRole(roleKey) {
  return PRIVILEGED_COMPANY_ROLES.includes(roleKey);
}

export function canManageWorkAssignments(roleKey) {
  return isPrivilegedCompanyRole(roleKey);
}

export function canPerformWorkAreaWrite(assignment, requiredDutyRoles = ["OPERATOR", "SUPERVISOR", "APPROVER"]) {
  return Boolean(
    assignment
    && assignment.status === "ACTIVE"
    && requiredDutyRoles.includes(assignment.duty_role),
  );
}

export function assignmentMatchesScope(assignment, { companyId, staffMembershipId, branchId, workArea }) {
  return Boolean(
    assignment
    && assignment.status === "ACTIVE"
    && assignment.company_id === companyId
    && assignment.staff_membership_id === staffMembershipId
    && assignment.branch_id === branchId
    && assignment.work_area === workArea,
  );
}

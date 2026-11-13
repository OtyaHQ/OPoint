export type PermissionScopeType = "COMPANY" | "OUTLET" | "PROVIDER_ACCOUNT" | "SELF";

export interface PermissionDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export interface PermissionPrincipal {
  id: string;
  company_id: string;
}

export interface PermissionScopeContext {
  outletId?: string | null;
  providerAccountId?: string | null;
  now?: string;
}

export interface PermissionGrantScope {
  scope_type: PermissionScopeType;
  scope_id: string | null;
}

const PERMISSION_SCOPE_QUERY = [
  "SELECT g.scope_type, g.scope_id",
  "FROM omni_staff_permission_grants g",
  "WHERE g.company_id = ?1",
  "  AND g.staff_membership_id = ?2",
  "  AND g.permission_key = ?3",
  "  AND g.status = 'ACTIVE'",
  "  AND datetime(g.starts_at) <= datetime(?6)",
  "  AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime(?6))",
  "  AND (",
  "    (g.scope_type = 'COMPANY' AND g.scope_id IS NULL)",
  "    OR (g.scope_type = 'SELF' AND g.scope_id = ?2)",
  "    OR (g.scope_type = 'OUTLET' AND g.scope_id = ?4 AND EXISTS (",
  "      SELECT 1 FROM omni_enterprise_employees e",
  "      JOIN omni_employee_outlet_assignments a ON a.employee_id=e.id AND a.company_id=e.company_id",
  "      JOIN omni_enterprise_outlets o ON o.id=a.outlet_id AND o.company_id=a.company_id",
  "      WHERE e.staff_membership_id=g.staff_membership_id",
  "        AND e.company_id=g.company_id AND e.employment_status='ACTIVE'",
  "        AND a.outlet_id=g.scope_id AND a.status='ACTIVE'",
  "        AND datetime(a.starts_at) <= datetime(?6)",
  "        AND (a.ends_at IS NULL OR datetime(a.ends_at) > datetime(?6))",
  "        AND o.status='ACTIVE'",
  "    ))",
  "    OR (g.scope_type = 'PROVIDER_ACCOUNT' AND g.scope_id = ?5 AND EXISTS (",
  "      SELECT 1 FROM omni_enterprise_employees e",
  "      JOIN omni_provider_operator_profiles p ON p.employee_id=e.id AND p.company_id=e.company_id",
  "      JOIN omni_provider_outlet_accounts a ON a.id=p.provider_outlet_account_id AND a.company_id=p.company_id",
  "      JOIN omni_provider_relationships r ON r.id=a.provider_relationship_id AND r.company_id=a.company_id",
  "      JOIN omni_employee_outlet_assignments oa ON oa.employee_id=e.id AND oa.company_id=e.company_id AND oa.outlet_id=a.outlet_id",
  "      JOIN omni_enterprise_outlets o ON o.id=a.outlet_id AND o.company_id=a.company_id",
  "      WHERE e.staff_membership_id=g.staff_membership_id",
  "        AND e.company_id=g.company_id AND e.employment_status='ACTIVE'",
  "        AND a.id=g.scope_id AND a.status='ACTIVE'",
  "        AND r.agreement_status='APPROVED' AND p.approval_status='APPROVED'",
  "        AND oa.status='ACTIVE' AND datetime(oa.starts_at) <= datetime(?6)",
  "        AND (oa.ends_at IS NULL OR datetime(oa.ends_at) > datetime(?6))",
  "        AND o.status='ACTIVE'",
  "    ))",
  "  )",
  "ORDER BY CASE g.scope_type WHEN 'COMPANY' THEN 0 WHEN 'OUTLET' THEN 1 WHEN 'PROVIDER_ACCOUNT' THEN 2 ELSE 3 END",
  "LIMIT 1"
].join("\n");

/**
 * Return the strongest current grant matching this request.
 * Legacy company-wide queries must not pass an outlet/provider scope unless
 * their SQL data query is filtered by that same scope.
 */
export async function findPermissionScope(
  db: PermissionDatabase,
  staff: PermissionPrincipal,
  permissionKey: string,
  context: PermissionScopeContext = {},
): Promise<PermissionGrantScope | null> {
  if (!staff?.id || !staff.company_id || !permissionKey) return null;

  const now = context.now ?? new Date().toISOString();
  const row = await db.prepare(PERMISSION_SCOPE_QUERY)
    .bind(
      staff.company_id,
      staff.id,
      permissionKey,
      context.outletId || "",
      context.providerAccountId || "",
      now,
    )
    .first<PermissionGrantScope>();

  return row && (
    row.scope_type === "COMPANY" ||
    row.scope_type === "OUTLET" ||
    row.scope_type === "PROVIDER_ACCOUNT" ||
    row.scope_type === "SELF"
  ) ? row : null;
}

export async function hasPermission(
  db: PermissionDatabase,
  staff: PermissionPrincipal,
  permissionKey: string,
  context: PermissionScopeContext = {},
): Promise<boolean> {
  return (await findPermissionScope(db, staff, permissionKey, context)) !== null;
}

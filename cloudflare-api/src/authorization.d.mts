export type PermissionScopeType = "COMPANY" | "OUTLET" | "PROVIDER_ACCOUNT" | "SELF";
export interface PermissionDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}
export interface PermissionPrincipal { id: string; company_id: string; }
export interface PermissionScopeContext { outletId?: string | null; providerAccountId?: string | null; now?: string; }
export interface PermissionGrantScope { scope_type: PermissionScopeType; scope_id: string | null; }
export function findPermissionScope(db: PermissionDatabase, staff: PermissionPrincipal, permissionKey: string, context?: PermissionScopeContext): Promise<PermissionGrantScope | null>;
export function hasPermission(db: PermissionDatabase, staff: PermissionPrincipal, permissionKey: string, context?: PermissionScopeContext): Promise<boolean>;

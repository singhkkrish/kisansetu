import type { UserRole } from "@/types/domain";

export const ROLES = ["centre_operator", "office_manager"] as const satisfies readonly UserRole[];

export function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = [
  "members:read",
  "members:write",
  "members:bank:read",
  "members:bank:verify",
  "prices:read",
  "prices:write",
  "procurement:create",
  "procurement:read_own_centre",
  "procurement:read_all",
  "procurement:approve",
  "payment_runs:create",
  "payment_runs:approve",
  "dashboard:financial",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The single place that says what each role may do. API routes and pages ask
 * `can()`; the database enforces the same rules again through row level
 * security, so a bug here cannot expose data on its own.
 */
const GRANTS: Record<UserRole, readonly Permission[]> = {
  centre_operator: [
    "members:read",
    "prices:read",
    "procurement:create",
    "procurement:read_own_centre",
  ],
  office_manager: [
    "members:read",
    "members:write",
    "members:bank:read",
    "members:bank:verify",
    "prices:read",
    "prices:write",
    "procurement:read_all",
    "procurement:approve",
    "payment_runs:create",
    "payment_runs:approve",
    "dashboard:financial",
  ],
};

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return GRANTS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: UserRole): readonly Permission[] {
  return GRANTS[role];
}

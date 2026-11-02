import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, can, isRole, permissionsFor, type Permission } from "@/lib/auth/permissions";

describe("role permissions", () => {
  describe("centre operator", () => {
    it.each<Permission>([
      "members:read",
      "procurement:create",
      "procurement:read_own_centre",
    ])("can %s", (permission) => {
      expect(can("centre_operator", permission)).toBe(true);
    });

    it.each<Permission>([
      "prices:write",
      "payment_runs:create",
      "payment_runs:approve",
      "procurement:approve",
      "procurement:read_all",
      "members:write",
      "members:bank:read",
      "members:bank:verify",
      "dashboard:financial",
    ])("cannot %s", (permission) => {
      expect(can("centre_operator", permission)).toBe(false);
    });
  });

  describe("office manager", () => {
    it.each<Permission>([
      "members:read",
      "members:write",
      "members:bank:read",
      "members:bank:verify",
      "prices:write",
      "procurement:read_all",
      "procurement:approve",
      "payment_runs:create",
      "dashboard:financial",
    ])("can %s", (permission) => {
      expect(can("office_manager", permission)).toBe(true);
    });

    it("does not record purchases, which is the operator's job", () => {
      expect(can("office_manager", "procurement:create")).toBe(false);
    });
  });

  it("gives nothing to a missing or unknown role", () => {
    for (const permission of PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(can("admin" as never, permission)).toBe(false);
    }
  });

  it("limits bank access to the office manager and no one else", () => {
    const withBankAccess = ROLES.filter((role) => can(role, "members:bank:read"));
    expect(withBankAccess).toEqual(["office_manager"]);
  });

  it("gives the operator a strict subset of what the manager can do, plus recording purchases", () => {
    const operatorOnly = permissionsFor("centre_operator").filter((p) => !can("office_manager", p));
    expect(operatorOnly.sort()).toEqual(["procurement:create", "procurement:read_own_centre"]);
  });

  it("recognises only the two roles", () => {
    expect(isRole("centre_operator")).toBe(true);
    expect(isRole("office_manager")).toBe(true);
    expect(isRole("CENTRE_OPERATOR")).toBe(false);
    expect(isRole("admin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

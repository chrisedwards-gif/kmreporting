import type { AppRole } from "@/lib/types";

export type Capabilities = {
  editReports: boolean;
  approveReports: boolean;
  manageGroup: boolean;
  maintainTrackers: boolean;
  admin: boolean;
};

/**
 * Authorisation is derived from the authenticated database role only.
 * Operating modes may scope records and navigation, but must never reduce
 * the actions the authenticated person is allowed to perform.
 */
export const capabilitiesFor = (actualRole: AppRole): Capabilities => ({
  editReports: ["admin", "group_manager", "kitchen_manager"].includes(actualRole),
  approveReports: ["admin", "group_manager"].includes(actualRole),
  manageGroup: ["admin", "group_manager"].includes(actualRole),
  maintainTrackers: ["admin", "group_manager", "kitchen_manager"].includes(actualRole),
  admin: actualRole === "admin",
});

/**
 * Navigation describes the workspace being inspected, not the actor's powers.
 * An Admin viewing a kitchen sees the same routes as its Kitchen Manager.
 */
export const navigationRoleFor = (actualRole: AppRole, hasKitchenContext: boolean): AppRole =>
  actualRole === "admin" && hasKitchenContext ? "kitchen_manager" : actualRole;

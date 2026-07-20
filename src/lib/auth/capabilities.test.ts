import { describe, expect, it } from "vitest";
import { capabilitiesFor, navigationRoleFor } from "./capabilities";

describe("capabilitiesFor", () => {
  it("keeps Admin powers unchanged in a kitchen-scoped workspace", () => {
    expect(capabilitiesFor("admin")).toEqual({
      editReports: true,
      approveReports: true,
      manageGroup: true,
      maintainTrackers: true,
      admin: true,
    });
    expect(navigationRoleFor("admin", true)).toBe("kitchen_manager");
  });

  it("gives Kitchen Managers operational write powers without group approval or admin", () => {
    expect(capabilitiesFor("kitchen_manager")).toEqual({
      editReports: true,
      approveReports: false,
      manageGroup: false,
      maintainTrackers: true,
      admin: false,
    });
  });

  it("keeps reporting viewers read-only", () => {
    expect(capabilitiesFor("viewer")).toEqual({
      editReports: false,
      approveReports: false,
      manageGroup: false,
      maintainTrackers: false,
      admin: false,
    });
  });

  it("does not change non-Admin navigation roles when a site context is present", () => {
    expect(navigationRoleFor("group_manager", true)).toBe("group_manager");
    expect(navigationRoleFor("kitchen_manager", true)).toBe("kitchen_manager");
  });
});

import { describe, expect, it } from "vitest";
import { resolveKitchenCheckOwners } from "@/lib/data/kitchen-check-owners";

describe("resolveKitchenCheckOwners", () => {
  it("includes a multi-site member when another manager holds the primary assignment", () => {
    const owners = resolveKitchenCheckOwners({
      assignmentIds: ["warren"],
      membershipIds: ["scott"],
      savedOwnerIds: [],
      currentUser: { id: "scott", name: "Scott Hutton" },
      profileNames: new Map([["warren", "Warren Manager"]]),
    });

    expect(owners).toEqual([
      { id: "scott", name: "Scott Hutton" },
      { id: "warren", name: "Warren Manager" },
    ]);
  });

  it("falls back to the signed-in checker when RLS hides all other owners", () => {
    const owners = resolveKitchenCheckOwners({
      assignmentIds: [],
      membershipIds: [],
      savedOwnerIds: [],
      currentUser: { id: "scott", name: "Scott Hutton" },
      profileNames: new Map(),
    });

    expect(owners).toEqual([{ id: "scott", name: "Scott Hutton" }]);
  });

  it("preserves an owner already saved on a draft", () => {
    const owners = resolveKitchenCheckOwners({
      assignmentIds: [],
      membershipIds: [],
      savedOwnerIds: ["existing-owner"],
      currentUser: null,
      profileNames: new Map([["existing-owner", "Existing Owner"]]),
    });

    expect(owners).toEqual([{ id: "existing-owner", name: "Existing Owner" }]);
  });
});

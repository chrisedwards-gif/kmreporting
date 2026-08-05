import { describe, expect, it } from "vitest";
import { selectKitchenCheckOwners, type KitchenCheckOwnerProfile } from "@/lib/kitchen-checks/owners";

const scott: KitchenCheckOwnerProfile = { id: "scott", fullName: "Scott Hutton", role: "kitchen_manager", active: true };
const warren: KitchenCheckOwnerProfile = { id: "warren", fullName: "Warren Raisbeck", role: "kitchen_manager", active: true };
const chris: KitchenCheckOwnerProfile = { id: "chris", fullName: "Chris Edwards", role: "admin", active: true };

describe("kitchen check action owners", () => {
  it("keeps a multi-site manager selectable through site membership without a primary assignment", () => {
    expect(selectKitchenCheckOwners({
      profiles: [scott],
      assignedProfileIds: [],
      memberProfileIds: [scott.id],
      savedOwnerProfileIds: [],
      actorProfileId: scott.id,
    })).toEqual([{ id: scott.id, name: scott.fullName }]);
  });

  it("combines active site assignments and memberships for group management", () => {
    expect(selectKitchenCheckOwners({
      profiles: [warren, scott, chris],
      assignedProfileIds: [warren.id],
      memberProfileIds: [warren.id, scott.id],
      savedOwnerProfileIds: [],
      actorProfileId: chris.id,
    })).toEqual([
      { id: scott.id, name: scott.fullName },
      { id: warren.id, name: warren.fullName },
    ]);
  });

  it("falls back to the signed-in checker when a kitchen has no manager record", () => {
    expect(selectKitchenCheckOwners({
      profiles: [chris],
      assignedProfileIds: [],
      memberProfileIds: [],
      savedOwnerProfileIds: [],
      actorProfileId: chris.id,
    })).toEqual([{ id: chris.id, name: chris.fullName }]);
  });

  it("preserves a previously selected owner when assignments change", () => {
    expect(selectKitchenCheckOwners({
      profiles: [{ ...warren, active: false }],
      assignedProfileIds: [],
      memberProfileIds: [],
      savedOwnerProfileIds: [warren.id],
      actorProfileId: null,
    })).toEqual([{ id: warren.id, name: warren.fullName }]);
  });
});

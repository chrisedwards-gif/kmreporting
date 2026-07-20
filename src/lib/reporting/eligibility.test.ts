import { describe, expect, it } from "vitest";
import { filterActiveExpectedSites } from "@/lib/reporting/eligibility";

describe("filterActiveExpectedSites", () => {
  it("keeps active kitchens and removes a switched-off kitchen from awaiting reports", () => {
    const expected = [
      { id: "dr", name: "Dough Religion" },
      { id: "kardia", name: "Kardia" },
      { id: "choi-wan", name: "Choi Wan" },
    ];
    const active = [{ id: "dr" }, { id: "kardia" }];

    expect(filterActiveExpectedSites(expected, active)).toEqual([
      { id: "dr", name: "Dough Religion" },
      { id: "kardia", name: "Kardia" },
    ]);
  });
});

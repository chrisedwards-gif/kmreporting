import { describe, expect, it } from "vitest";
import { filterToSiteScope, scopeContainsSite, siteIsInScope } from "@/lib/auth/site-scope";

const dough = "00000000-0000-4000-8000-000000000001";
const kardia = "00000000-0000-4000-8000-000000000003";

describe("site scope", () => {
  it("keeps every site in group scope", () => {
    expect(scopeContainsSite(null, dough)).toBe(true);
    expect(scopeContainsSite(null, kardia)).toBe(true);
  });

  it("rejects another kitchen from a selected workspace", () => {
    expect(scopeContainsSite([kardia], kardia)).toBe(true);
    expect(scopeContainsSite([kardia], dough)).toBe(false);
  });

  it("keeps intentionally group-wide records visible", () => {
    expect(siteIsInScope([kardia], null)).toBe(true);
  });

  it("treats an empty Kitchen Manager assignment as no site access", () => {
    expect(scopeContainsSite([], dough)).toBe(false);
    expect(scopeContainsSite([], kardia)).toBe(false);
  });

  it("filters mixed records without cross-kitchen leakage", () => {
    const rows = [
      { id: "group", siteId: null },
      { id: "dough", siteId: dough },
      { id: "kardia", siteId: kardia },
    ];
    expect(filterToSiteScope([kardia], rows).map((row) => row.id)).toEqual(["group", "kardia"]);
  });
});

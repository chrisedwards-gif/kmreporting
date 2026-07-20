import { describe, expect, it } from "vitest";
import type { ReportingBundle } from "@/lib/data/reporting";
import { getWorkbench } from "@/lib/data/workbench";

const bundle = {
  week: { id: "week", start: "2026-07-12", end: "2026-07-18", dueAt: "2026-07-21T12:00:00Z" },
  sites: [],
  expectedSiteCount: 2,
  expectedSites: [
    { id: "dough", name: "Dough Religion", code: "DR" },
    { id: "kardia", name: "Kardia", code: "KA" },
  ],
  reports: [
    { id: "report-dough", siteId: "dough", siteName: "Dough Religion", status: "submitted" },
  ],
} as unknown as ReportingBundle;

describe("read-only persona workbench", () => {
  it("surfaces reporting coverage, release status and the weekly pack", async () => {
    const result = await getWorkbench("viewer", bundle);

    expect(result.items.map((item) => item.key)).toEqual([
      "reader-reported",
      "reader-approval",
      "reader-summary",
    ]);
    expect(result.items[0]?.detail).toContain("Kardia");
    expect(result.items[2]?.href).toBe("/summary");
    expect(result.allClear).toBe(false);
  });

  it("does not present role access as a green operational all-clear", async () => {
    const result = await getWorkbench("finance", bundle);
    expect(result.clearMessage).toBe("");
    expect(result.items.some((item) => item.title === "Management summary")).toBe(true);
  });
});

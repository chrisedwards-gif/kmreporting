import { describe, expect, it } from "vitest";
import { resolveComparisonRange } from "@/lib/reporting/comparison-ranges";

describe("resolveComparisonRange", () => {
  it("builds the full calendar month", () => {
    expect(resolveComparisonRange({ mode: "month", anchor: "2026-07-18" })).toMatchObject({ start: "2026-07-01", end: "2026-07-31", label: "July 2026" });
  });

  it("builds an exact day for same-day comparisons", () => {
    expect(resolveComparisonRange({ mode: "day", anchor: "2026-07-18" })).toMatchObject({ start: "2026-07-18", end: "2026-07-18" });
  });

  it("builds a calendar year", () => {
    expect(resolveComparisonRange({ mode: "year", anchor: "2026-07-18" })).toMatchObject({ start: "2026-01-01", end: "2026-12-31", label: "2026" });
  });

  it("falls back to month when a custom range is invalid", () => {
    expect(resolveComparisonRange({ mode: "custom", start: "2026-08-01", end: "2026-07-01", today: "2026-07-18" })).toMatchObject({ mode: "month", start: "2026-07-01", end: "2026-07-31" });
  });
});

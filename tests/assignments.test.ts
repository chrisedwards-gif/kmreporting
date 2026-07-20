import { describe, expect, it } from "vitest";
import { assignmentCoversWeek, isSunday, previousSaturday } from "@/lib/performance/assignments";

describe("site-manager assignments", () => {
  it("requires assignments to start on a Sunday", () => {
    expect(isSunday("2026-07-19")).toBe(true);
    expect(isSunday("2026-07-20")).toBe(false);
    expect(isSunday("not-a-date")).toBe(false);
  });

  it("covers a weekly review when any part of the assignment overlaps that week", () => {
    expect(assignmentCoversWeek("2026-07-19", null, "2026-07-19", "2026-07-25")).toBe(true);
    expect(assignmentCoversWeek("2026-07-22", null, "2026-07-19", "2026-07-25")).toBe(true);
    expect(assignmentCoversWeek("2026-07-26", null, "2026-07-19", "2026-07-25")).toBe(false);
  });

  it("preserves a former manager's final covered week", () => {
    expect(assignmentCoversWeek("2026-06-07", "2026-07-18", "2026-07-12", "2026-07-18")).toBe(true);
    expect(assignmentCoversWeek("2026-06-07", "2026-07-18", "2026-07-19", "2026-07-25")).toBe(false);
  });

  it("ends the old assignment on the Saturday before replacement", () => {
    expect(previousSaturday("2026-07-19")).toBe("2026-07-18");
    expect(previousSaturday("2026-07-20")).toBeNull();
  });
});

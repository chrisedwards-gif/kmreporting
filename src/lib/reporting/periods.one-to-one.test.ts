import { describe, expect, it } from "vitest";
import { getAvailableOneToOneWeek } from "@/lib/reporting/periods";

const now = new Date("2026-07-20T10:00:00Z");

describe("getAvailableOneToOneWeek", () => {
  it("opens a current-week 1-1 for a newly assigned manager", () => {
    expect(getAvailableOneToOneWeek({ assignmentStartsOn: "2026-07-19", assignmentEndsOn: null }, now)).toMatchObject({
      start: "2026-07-19",
      end: "2026-07-25",
      isComplete: false,
    });
  });

  it("prefers the latest completed week when the assignment covered it", () => {
    expect(getAvailableOneToOneWeek({ assignmentStartsOn: "2026-07-01", assignmentEndsOn: null }, now)).toMatchObject({
      start: "2026-07-12",
      end: "2026-07-18",
      isComplete: true,
    });
  });

  it("does not create a review before an assignment begins", () => {
    expect(getAvailableOneToOneWeek({ assignmentStartsOn: "2026-07-26", assignmentEndsOn: null }, now)).toBeNull();
  });
});

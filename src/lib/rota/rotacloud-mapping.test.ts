import { describe, expect, it } from "vitest";
import { mergeRotaCloudAvailability } from "@/lib/rota/rotacloud-mapping";

describe("RotaCloud availability mapping", () => {
  it("conservatively blocks approved leave dates", () => {
    const result = mergeRotaCloudAvailability([
      { user: 7, dates: [{ date: "2026-07-25", available: [{ start_time: "10:00", end_time: "22:00" }], unavailable: [] }] },
    ], [
      { user: 7, deleted: false, status: "approved", dates: [{ date: "2026-07-25", days: 0.5 }] },
    ]);

    expect(result.get(7)?.[0].unavailable).toEqual([{ startTime: "00:00", endTime: "00:00" }]);
  });

  it("ignores deleted or unapproved leave", () => {
    const result = mergeRotaCloudAvailability([], [
      { user: 7, deleted: false, status: "denied", dates: [{ date: "2026-07-25", days: 1 }] },
      { user: 8, deleted: true, status: "approved", dates: [{ date: "2026-07-25", days: 1 }] },
    ]);

    expect(result.size).toBe(0);
  });
});

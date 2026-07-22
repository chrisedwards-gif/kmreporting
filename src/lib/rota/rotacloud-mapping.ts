import type { StaffAvailabilityDay } from "@/lib/rota/types";

export type RotaCloudAvailabilityRow = {
  user: number;
  dates: Array<{
    date: string;
    available: Array<{ start_time: string; end_time: string }>;
    unavailable: Array<{ start_time: string; end_time: string }>;
  }>;
};

export type RotaCloudLeaveRow = {
  deleted: boolean;
  status: string;
  user: number;
  dates: Array<{ date: string; days?: number | null; hours?: number | null; day_off?: boolean | null }>;
};

export function mergeRotaCloudAvailability(
  availabilityRows: RotaCloudAvailabilityRow[],
  leaveRows: RotaCloudLeaveRow[],
) {
  const result = new Map<number, StaffAvailabilityDay[]>();
  for (const row of availabilityRows) {
    result.set(row.user, row.dates.map((day) => ({
      date: day.date,
      available: day.available.map((window) => ({ startTime: window.start_time, endTime: window.end_time })),
      unavailable: day.unavailable.map((window) => ({ startTime: window.start_time, endTime: window.end_time })),
    })));
  }

  for (const leave of leaveRows) {
    if (leave.deleted || leave.status !== "approved") continue;
    const days = result.get(leave.user) ?? [];
    for (const leaveDay of leave.dates) {
      const day = days.find((candidate) => candidate.date === leaveDay.date) ?? {
        date: leaveDay.date,
        available: [],
        unavailable: [],
      };
      if (!days.includes(day)) days.push(day);
      if (!day.unavailable.some((window) => window.startTime === "00:00" && window.endTime === "00:00")) {
        // Conservatively block the whole date until real-account UAT confirms
        // RotaCloud's AM/PM semantics for every leave configuration.
        day.unavailable.push({ startTime: "00:00", endTime: "00:00" });
      }
    }
    result.set(leave.user, days.sort((a, b) => a.date.localeCompare(b.date)));
  }
  return result;
}

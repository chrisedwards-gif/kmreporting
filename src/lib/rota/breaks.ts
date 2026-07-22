import type { RotaPlanDay, SuggestedShift } from "@/lib/rota/types";

export type SuggestedBreak = {
  shiftIndex: number;
  startTime: string | null;
  endTime: string | null;
  minutes: number;
  reason: string;
};

const timeToMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(minutes);
};

const minutesToTime = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

const shiftMinutes = (shift: SuggestedShift) => Math.max(0, (new Date(shift.shiftEnd).getTime() - new Date(shift.shiftStart).getTime()) / 60_000);

export function suggestBreaks(day: RotaPlanDay): SuggestedBreak[] {
  const reserved = new Map<number, number>();
  const peakDemand = Math.max(...day.coverage.map((slot) => slot.demandWeight), 1);

  return day.shifts.map((shift, shiftIndex) => {
    const duration = shiftMinutes(shift);
    if (!shift.staffProfileId || duration < 6 * 60 || shift.breakMinutes <= 0) {
      return { shiftIndex, startTime: null, endTime: null, minutes: shift.breakMinutes, reason: shift.breakMinutes > 0 ? "Manager placement required." : "No planned break." };
    }

    const shiftStart = timeToMinutes(shift.shiftStart.slice(11, 16));
    const shiftEnd = timeToMinutes(shift.shiftEnd.slice(11, 16));
    const earliest = shiftStart + Math.max(120, Math.round(duration * 0.3));
    const latest = shiftEnd - Math.max(90, shift.breakMinutes);
    const candidates = day.coverage
      .map((slot) => ({ ...slot, minutes: timeToMinutes(slot.slotTime) }))
      .filter((slot) => slot.minutes >= earliest && slot.minutes <= latest)
      .map((slot) => {
        const demandPenalty = slot.demandWeight / peakDemand * 100;
        const coverageMargin = slot.assigned - slot.required;
        const coveragePenalty = coverageMargin < 1 ? 80 : coverageMargin === 1 ? 12 : 0;
        const clashPenalty = (reserved.get(slot.minutes) ?? 0) * 100;
        const latePenalty = Math.abs(slot.minutes - (shiftStart + duration * 0.48)) / 60;
        return { ...slot, score: demandPenalty + coveragePenalty + clashPenalty + latePenalty };
      })
      .sort((a, b) => a.score - b.score || a.minutes - b.minutes);

    const selected = candidates[0];
    if (!selected) return { shiftIndex, startTime: null, endTime: null, minutes: shift.breakMinutes, reason: "No safe break window found without weakening cover." };
    reserved.set(selected.minutes, (reserved.get(selected.minutes) ?? 0) + 1);
    const end = selected.minutes + shift.breakMinutes;
    return {
      shiftIndex,
      startTime: minutesToTime(selected.minutes),
      endTime: minutesToTime(end),
      minutes: shift.breakMinutes,
      reason: selected.assigned > selected.required
        ? "Quiet demand window with cover above minimum."
        : "Lowest-risk available window; manager should confirm live cover.",
    };
  });
}

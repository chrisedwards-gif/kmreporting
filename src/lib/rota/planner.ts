import { addDays, backtestForecast, forecastDay, overallConfidence } from "@/lib/rota/forecasting";
import type {
  DemandPoint,
  ExistingStaffShift,
  RotaDayRule,
  RotaPlan,
  RotaPlanDay,
  RotaPlanningInput,
  RotaStaffProfile,
  SuggestedShift,
} from "@/lib/rota/types";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundHours = (minutes: number) => Math.round(minutes / 60 * 100) / 100;
const normaliseSkill = (value: string) => value.trim().toLowerCase();

export const timeToMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(minutes);
};

const minutesToTime = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const londonOffset = (date: string) => {
  const utcNoon = new Date(`${date}T12:00:00Z`);
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).format(utcNoon));
  return localHour === 13 ? "+01:00" : "+00:00";
};
const dateTime = (date: string, minutes: number) => `${date}T${minutesToTime(minutes)}:00${londonOffset(date)}`;
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

type Slot = { start: number; end: number; weight: number; required: number };
type ShiftPattern = { start: number; end: number; requiredSkill: string | null; layer: number };
type StaffState = { profile: RotaStaffProfile; assignedMinutes: number; shifts: SuggestedShift[] };

function ruleForDate(rules: RotaDayRule[], date: string) {
  return rules.find((rule) => rule.weekday === weekday(date));
}

function demandForDay(demand: DemandPoint[], day: number, open: number, close: number, interval: number) {
  const points = demand
    .filter((point) => point.weekday === day)
    .map((point) => ({ ...point, minutes: timeToMinutes(point.slotTime) }))
    .sort((a, b) => a.minutes - b.minutes);
  const byTime = new Map(points.map((point) => [timeToMinutes(point.slotTime), point]));
  const fallbackWeight = 1 / Math.max(1, Math.ceil((close - open) / interval));
  const weightAt = (start: number) => {
    const exact = byTime.get(start);
    if (exact) return exact.demandWeight;
    const before = [...points].reverse().find((point) => point.minutes < start);
    const after = points.find((point) => point.minutes > start);
    if (!before && !after) return fallbackWeight;
    if (!before) return after!.demandWeight;
    if (!after) return before.demandWeight;
    const progress = (start - before.minutes) / (after.minutes - before.minutes);
    return before.demandWeight + (after.demandWeight - before.demandWeight) * progress;
  };
  const slots: Slot[] = [];
  for (let start = open; start < close; start += interval) {
    slots.push({ start, end: Math.min(close, start + interval), weight: weightAt(start), required: 0 });
  }
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0) || 1;
  slots.forEach((slot) => { slot.weight /= total; });
  return slots;
}

function coverageTargets(slots: Slot[], rule: RotaDayRule, affordableHours: number) {
  const intervalHours = slots.length ? (slots[0].end - slots[0].start) / 60 : 1;
  slots.forEach((slot) => { slot.required = rule.minimumStaff; });
  const minimumUnits = slots.length * rule.minimumStaff;
  const affordableUnits = Math.max(minimumUnits, Math.round(affordableHours / intervalHours));
  let extras = Math.min(affordableUnits - minimumUnits, slots.length * (rule.maximumStaff - rule.minimumStaff));
  const ranked = [...slots].sort((a, b) => b.weight - a.weight || a.start - b.start);
  let cursor = 0;
  while (extras > 0 && ranked.length) {
    const slot = ranked[cursor % ranked.length];
    if (slot.required < rule.maximumStaff) {
      slot.required += 1;
      extras -= 1;
    }
    cursor += 1;
    if (cursor > ranked.length * rule.maximumStaff * 2) break;
  }
  return slots;
}

function patternsFromCoverage(slots: Slot[], rule: RotaDayRule, minimumPatternMinutes: number) {
  const patterns: ShiftPattern[] = [];
  const maxLayer = Math.max(0, ...slots.map((slot) => slot.required));
  for (let layer = 1; layer <= maxLayer; layer += 1) {
    let segmentStart: number | null = null;
    for (let index = 0; index <= slots.length; index += 1) {
      const slot = slots[index];
      const covered = Boolean(slot && slot.required >= layer);
      if (covered && segmentStart === null) segmentStart = slot.start;
      if (!covered && segmentStart !== null) {
        const end = slots[index - 1].end;
        let adjustedStart = segmentStart;
        let adjustedEnd = end;
        const shortfall = Math.max(0, minimumPatternMinutes - (adjustedEnd - adjustedStart));
        adjustedStart = Math.max(slots[0]?.start ?? adjustedStart, adjustedStart - Math.ceil(shortfall / 2));
        adjustedEnd = Math.min(slots.at(-1)?.end ?? adjustedEnd, adjustedEnd + shortfall - (segmentStart - adjustedStart));
        if (adjustedEnd - adjustedStart < minimumPatternMinutes) adjustedStart = Math.max(slots[0]?.start ?? adjustedStart, adjustedEnd - minimumPatternMinutes);
        patterns.push({ start: adjustedStart, end: adjustedEnd, requiredSkill: null, layer });
        segmentStart = null;
      }
    }
  }
  const longest = [...patterns].sort((a, b) => (b.end - b.start) - (a.end - a.start));
  rule.requiredSkills.forEach((skill, index) => {
    if (longest[index]) longest[index].requiredSkill = normaliseSkill(skill);
  });
  return patterns.sort((a, b) => a.start - b.start || a.layer - b.layer);
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function profileHasSkill(profile: RotaStaffProfile, required: string | null) {
  if (!required) return true;
  const skills = [profile.primaryRole, profile.roleTitle, ...profile.skills].map(normaliseSkill);
  return skills.some((skill) => skill === required || skill.includes(required) || required.includes(skill));
}

function availabilityAllows(profile: RotaStaffProfile, date: string, start: number, end: number) {
  const day = profile.availability?.find((item) => item.date === date);
  if (!day) return true;
  if (day.unavailable.some((window) => {
    const unavailableStart = timeToMinutes(window.startTime);
    const unavailableEnd = window.startTime === window.endTime ? 24 * 60 : timeToMinutes(window.endTime);
    return overlaps(start, end, unavailableStart, unavailableEnd);
  })) return false;
  if (!day.available.length) return true;
  return day.available.some((window) => {
    const availableStart = timeToMinutes(window.startTime);
    const availableEnd = window.startTime === window.endTime ? 24 * 60 : timeToMinutes(window.endTime);
    return start >= availableStart && end <= availableEnd;
  });
}

function consecutiveDays(state: StaffState, date: string) {
  const dates = new Set(state.shifts.map((shift) => shift.shiftStart.slice(0, 10)));
  dates.add(date);
  const sorted = [...dates].sort();
  let longest = 1;
  let current = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const prior = new Date(`${sorted[index - 1]}T12:00:00Z`).getTime();
    const next = new Date(`${sorted[index]}T12:00:00Z`).getTime();
    current = next - prior === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function restAllows(state: StaffState, startIso: string, endIso: string, minimumRestHours: number, existing: ExistingStaffShift[]) {
  const proposedStart = new Date(startIso).getTime();
  const proposedEnd = new Date(endIso).getTime();
  const minimumRestMs = minimumRestHours * 3_600_000;
  const all = [
    ...state.shifts.map((shift) => ({ start: shift.shiftStart, end: shift.shiftEnd })),
    ...existing.filter((shift) => shift.staffProfileId === state.profile.id).map((shift) => ({ start: shift.shiftStart, end: shift.shiftEnd })),
  ];
  return all.every((shift) => {
    const start = new Date(shift.start).getTime();
    const end = new Date(shift.end).getTime();
    if (overlaps(proposedStart, proposedEnd, start, end)) return false;
    if (end <= proposedStart) return proposedStart - end >= minimumRestMs;
    return start - proposedEnd >= minimumRestMs;
  });
}

function candidateScore(state: StaffState, date: string, start: number, end: number, requiredSkill: string | null) {
  const profile = state.profile;
  const hours = state.assignedMinutes / 60;
  const targetGap = Math.max(0, profile.targetWeeklyHours - hours);
  const minimumGap = Math.max(0, profile.minimumWeeklyHours - hours);
  let score = targetGap * 1.4 + minimumGap * 2;
  if (profile.preferredDays.includes(weekday(date))) score += 18;
  if (profile.preferredStart && start >= timeToMinutes(profile.preferredStart)) score += 4;
  if (profile.preferredEnd && end <= timeToMinutes(profile.preferredEnd)) score += 4;
  if (requiredSkill && profileHasSkill(profile, requiredSkill)) score += 30;
  if (profile.payBasis === "salaried") score += 8;
  score -= Math.min(12, profile.loadedHourlyRate / 3);
  return score;
}

function assignPatterns(input: {
  date: string;
  patterns: ShiftPattern[];
  states: StaffState[];
  existing: ExistingStaffShift[];
  minimumRestHours: number;
}) {
  const shifts: SuggestedShift[] = [];
  const warnings: string[] = [];
  for (const pattern of input.patterns) {
    const duration = pattern.end - pattern.start;
    const startIso = dateTime(input.date, pattern.start);
    const endIso = dateTime(input.date, pattern.end);
    const candidates = input.states.filter((state) => {
      const profile = state.profile;
      return duration >= profile.minimumShiftMinutes
        && duration <= profile.maximumShiftMinutes
        && state.assignedMinutes + duration <= profile.maximumWeeklyHours * 60
        && profileHasSkill(profile, pattern.requiredSkill)
        && availabilityAllows(profile, input.date, pattern.start, pattern.end)
        && consecutiveDays(state, input.date) <= profile.maximumConsecutiveDays
        && restAllows(state, startIso, endIso, input.minimumRestHours, input.existing);
    }).sort((a, b) => candidateScore(b, input.date, pattern.start, pattern.end, pattern.requiredSkill) - candidateScore(a, input.date, pattern.start, pattern.end, pattern.requiredSkill)
      || a.profile.staffName.localeCompare(b.profile.staffName));

    const selected = candidates[0];
    const breakMinutes = duration >= 6 * 60 ? 30 : 0;
    const paidMinutes = duration - breakMinutes;
    if (!selected) {
      warnings.push(`Unfilled ${minutesToTime(pattern.start)}–${minutesToTime(pattern.end)}${pattern.requiredSkill ? ` (${pattern.requiredSkill})` : ""}.`);
      shifts.push({
        staffProfileId: null,
        staffName: "Unfilled shift",
        roleTitle: pattern.requiredSkill ?? "Cover required",
        shiftStart: startIso,
        shiftEnd: endIso,
        breakMinutes,
        paidMinutes,
        requiredSkill: pattern.requiredSkill,
        assignmentReason: "No available team member met every hard constraint.",
        payBasis: "unfilled",
        privateCost: 0,
      });
      continue;
    }

    const profile = selected.profile;
    const privateCost = profile.payBasis === "hourly" ? profile.loadedHourlyRate * paidMinutes / 60 : 0;
    const reason = [
      profile.preferredDays.includes(weekday(input.date)) ? "preferred day" : "available day",
      pattern.requiredSkill ? `${pattern.requiredSkill} cover` : profile.roleTitle || profile.primaryRole,
      `${roundHours(selected.assignedMinutes + paidMinutes)}h projected this week`,
    ].filter(Boolean).join(" · ");
    const shift: SuggestedShift = {
      staffProfileId: profile.id,
      staffName: profile.staffName,
      roleTitle: profile.roleTitle || profile.primaryRole,
      shiftStart: startIso,
      shiftEnd: endIso,
      breakMinutes,
      paidMinutes,
      requiredSkill: pattern.requiredSkill,
      assignmentReason: reason,
      payBasis: profile.payBasis,
      privateCost: privateCost,
    };
    selected.assignedMinutes += paidMinutes;
    selected.shifts.push(shift);
    shifts.push(shift);
  }
  return { shifts, warnings };
}

function coverageActual(slots: Slot[], shifts: SuggestedShift[]) {
  return slots.map((slot) => ({
    slotTime: minutesToTime(slot.start),
    required: slot.required,
    assigned: shifts.filter((shift) => shift.staffProfileId && overlaps(
      timeToMinutes(shift.shiftStart.slice(11, 16)),
      timeToMinutes(shift.shiftEnd.slice(11, 16)),
      slot.start,
      slot.end,
    )).length,
    demandWeight: Math.round(slot.weight * 1000) / 10,
  }));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function buildRotaPlan(input: RotaPlanningInput): RotaPlan {
  const forecastWeeks = input.forecastWeeks ?? 8;
  const minimumHistoryWeeks = input.minimumHistoryWeeks ?? 4;
  const minimumRestHours = input.minimumRestHours ?? 11;
  const intervalMinutes = input.intervalMinutes ?? 60;
  const salesPerLabourHourTarget = input.salesPerLabourHourTarget ?? 95;
  const weekEnd = addDays(input.weekStart, 6);
  const accuracyMape = backtestForecast(input.history, forecastWeeks, minimumHistoryWeeks);
  const forecasts = Array.from({ length: 7 }, (_, index) => forecastDay({
    businessDate: addDays(input.weekStart, index),
    history: input.history,
    events: input.events,
    forecastWeeks,
    minimumHistoryWeeks,
  }));
  const tradingDayCount = forecasts.filter((day) => ruleForDate(input.dayRules, day.businessDate)?.trading).length || 1;
  const fixedWeeklyCost = sum(input.staff.map((staff) => staff.fixedWeeklyCost * staff.costAllocationPct / 100));
  const fixedDailyCost = fixedWeeklyCost / tradingDayCount;
  const hourlyStaff = input.staff.filter((staff) => staff.payBasis === "hourly" && staff.loadedHourlyRate > 0);
  const blendedHourlyRate = hourlyStaff.length ? sum(hourlyStaff.map((staff) => staff.loadedHourlyRate)) / hourlyStaff.length : 0;
  const costedStaff = input.staff.filter((staff) => staff.loadedHourlyRate > 0);
  const blendedLoadedRate = costedStaff.length ? sum(costedStaff.map((staff) => staff.loadedHourlyRate)) / costedStaff.length : blendedHourlyRate;
  const states: StaffState[] = input.staff.map((profile) => ({ profile, assignedMinutes: 0, shifts: [] }));
  const existing = input.existingShifts ?? [];
  const days: RotaPlanDay[] = [];
  const planWarnings: string[] = [];

  for (const forecast of forecasts) {
    const rule = ruleForDate(input.dayRules, forecast.businessDate);
    if (!rule?.trading) continue;
    const open = timeToMinutes(rule.openTime) - rule.prepMinutes;
    const close = timeToMinutes(rule.closeTime) + rule.closeMinutes;
    const labourBudget = forecast.forecastSales * input.labourTargetPct / 100;
    const controllableBudget = Math.max(0, labourBudget - fixedDailyCost);
    const productivityHours = forecast.forecastSales / salesPerLabourHourTarget;
    const costAffordableHours = blendedLoadedRate > 0 ? labourBudget / blendedLoadedRate : productivityHours;
    const effectiveHours = Math.min(productivityHours, costAffordableHours);
    const slots = coverageTargets(
      demandForDay(input.demand, weekday(forecast.businessDate), open, close, intervalMinutes),
      rule,
      effectiveHours,
    );
    const minimumPatternMinutes = input.staff.length ? Math.min(...input.staff.map((staff) => staff.minimumShiftMinutes)) : 240;
    const patterns = patternsFromCoverage(slots, rule, minimumPatternMinutes);
    const assigned = assignPatterns({ date: forecast.businessDate, patterns, states, existing, minimumRestHours });
    const hourlyCost = sum(assigned.shifts.map((shift) => shift.privateCost));
    const plannedCost = fixedDailyCost + hourlyCost;
    const plannedHours = roundHours(sum(assigned.shifts.filter((shift) => shift.staffProfileId).map((shift) => shift.paidMinutes)));
    const peak = [...slots].sort((a, b) => b.weight - a.weight)[0];
    const dayWarnings = [...assigned.warnings];
    if (plannedCost > labourBudget * 1.02) dayWarnings.push(`Planned labour is ${roundMoney(plannedCost - labourBudget).toFixed(2)} over the target budget because minimum coverage or staff constraints take priority.`);
    if (forecast.historyValues.length < minimumHistoryWeeks) dayWarnings.push(`Only ${forecast.historyValues.length} comparable ${new Date(`${forecast.businessDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}s are available; treat this as indicative.`);
    const coverage = coverageActual(slots, assigned.shifts);
    if (coverage.some((slot) => slot.assigned < slot.required)) dayWarnings.push("One or more day-parts remain below the suggested coverage level.");
    days.push({
      businessDate: forecast.businessDate,
      forecastSales: forecast.forecastSales,
      forecastLow: forecast.low,
      forecastHigh: forecast.high,
      labourBudget: roundMoney(labourBudget),
      fixedLabourCost: roundMoney(fixedDailyCost),
      controllableBudget: roundMoney(controllableBudget),
      plannedCost: roundMoney(plannedCost),
      plannedHours,
      peakTime: peak ? minutesToTime(peak.start) : null,
      coverage,
      evidence: {
        method: "recency-weighted same weekday",
        historyValues: forecast.historyValues,
        excludedOutliers: forecast.excludedValues,
        baseForecast: forecast.baseForecast,
        eventUpliftPct: forecast.eventUpliftPct,
        salesPerLabourHourTarget,
        targetStaffHours: Math.round(effectiveHours * 100) / 100,
        demandSource: input.demand.some((point) => point.weekday === weekday(forecast.businessDate) && point.source === "hourly_sales") ? "hourly sales" : "editable day-part template",
      },
      warnings: dayWarnings,
      shifts: assigned.shifts,
    });
    planWarnings.push(...dayWarnings.map((warning) => `${forecast.businessDate}: ${warning}`));
  }

  for (const state of states) {
    const hours = state.assignedMinutes / 60;
    if (hours + 0.01 < state.profile.minimumWeeklyHours) {
      planWarnings.push(`${state.profile.staffName} is ${roundHours(state.profile.minimumWeeklyHours * 60 - state.assignedMinutes)}h below their minimum preference.`);
    }
  }

  const confidence = overallConfidence(forecasts, accuracyMape);
  const forecastSales = sum(days.map((day) => day.forecastSales));
  const labourBudget = sum(days.map((day) => day.labourBudget));
  const plannedCost = sum(days.map((day) => day.plannedCost));
  const within = accuracyMape === null ? "accuracy is still building" : `recent backtests are typically within ±${accuracyMape.toFixed(1)}%`;
  return {
    weekStart: input.weekStart,
    weekEnd,
    forecastSales: roundMoney(forecastSales),
    forecastLow: roundMoney(sum(days.map((day) => day.forecastLow))),
    forecastHigh: roundMoney(sum(days.map((day) => day.forecastHigh))),
    labourTargetPct: input.labourTargetPct,
    labourBudget: roundMoney(labourBudget),
    plannedCost: roundMoney(plannedCost),
    plannedHours: Math.round(sum(days.map((day) => day.plannedHours)) * 100) / 100,
    accuracyMape,
    confidence,
    explanation: `Forecast uses up to ${forecastWeeks} matching weekdays with recent weeks weighted most heavily; ${within}. Coverage follows the site day-part curve, then named shifts are assigned within availability, rest, skill and weekly-hour limits.`,
    warnings: [...new Set(planWarnings)],
    days,
  };
}

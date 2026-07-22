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

function coverageTargets(slots: Slot[], rule: RotaDayRule, targetHours: number) {
  const intervalHours = slots.length ? (slots[0].end - slots[0].start) / 60 : 1;
  slots.forEach((slot) => { slot.required = rule.minimumStaff; });
  const minimumUnits = slots.length * rule.minimumStaff;
  const targetUnits = Math.max(minimumUnits, Math.round(targetHours / intervalHours));
  let extras = Math.min(targetUnits - minimumUnits, slots.length * (rule.maximumStaff - rule.minimumStaff));
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

function extendShortPattern(pattern: ShiftPattern, dayStart: number, dayEnd: number, minimumMinutes: number) {
  let start = pattern.start;
  let end = pattern.end;
  const missing = Math.max(0, minimumMinutes - (end - start));
  start = Math.max(dayStart, start - Math.ceil(missing / 2));
  end = Math.min(dayEnd, end + missing - (pattern.start - start));
  if (end - start < minimumMinutes) start = Math.max(dayStart, end - minimumMinutes);
  if (end - start < minimumMinutes) end = Math.min(dayEnd, start + minimumMinutes);
  return { ...pattern, start, end };
}

function splitLongPattern(pattern: ShiftPattern, dayStart: number, dayEnd: number, interval: number, preferredMinimum: number, maximumMinutes: number) {
  const extended = extendShortPattern(pattern, dayStart, dayEnd, Math.min(preferredMinimum, dayEnd - dayStart));
  const duration = extended.end - extended.start;
  if (duration <= maximumMinutes || maximumMinutes <= 0) return [extended];

  const count = Math.max(2, Math.ceil(duration / maximumMinutes));
  const chunkMinutes = Math.min(
    maximumMinutes,
    Math.max(preferredMinimum, Math.ceil(duration / count / interval) * interval),
  );
  const usableSpan = Math.max(0, duration - chunkMinutes);
  const starts = Array.from({ length: count }, (_, index) => {
    if (index === 0) return extended.start;
    if (index === count - 1) return extended.end - chunkMinutes;
    const raw = extended.start + usableSpan * index / (count - 1);
    return Math.round(raw / interval) * interval;
  });

  return [...new Set(starts)].map((start) => ({
    ...extended,
    start: Math.max(dayStart, start),
    end: Math.min(dayEnd, start + chunkMinutes),
  }));
}

function patternsFromCoverage(slots: Slot[], rule: RotaDayRule, staff: RotaStaffProfile[], interval: number) {
  const rawPatterns: ShiftPattern[] = [];
  const maxLayer = Math.max(0, ...slots.map((slot) => slot.required));
  for (let layer = 1; layer <= maxLayer; layer += 1) {
    let segmentStart: number | null = null;
    for (let index = 0; index <= slots.length; index += 1) {
      const slot = slots[index];
      const covered = Boolean(slot && slot.required >= layer);
      if (covered && segmentStart === null) segmentStart = slot.start;
      if (!covered && segmentStart !== null) {
        rawPatterns.push({ start: segmentStart, end: slots[index - 1].end, requiredSkill: null, layer });
        segmentStart = null;
      }
    }
  }

  const longest = [...rawPatterns].sort((a, b) => (b.end - b.start) - (a.end - a.start));
  rule.requiredSkills.forEach((skill, index) => {
    if (longest[index]) longest[index].requiredSkill = normaliseSkill(skill);
  });

  const dayStart = slots[0]?.start ?? 0;
  const dayEnd = slots.at(-1)?.end ?? dayStart;
  const splitPatterns = rawPatterns.flatMap((pattern) => {
    const eligible = staff.filter((profile) => profileHasSkill(profile, pattern.requiredSkill));
    const maximumConfigured = Math.max(0, ...(eligible.length ? eligible : staff).map((profile) => profile.maximumShiftMinutes));
    const maximumMinutes = pattern.requiredSkill
      ? maximumConfigured
      : Math.min(600, maximumConfigured || 600);
    const preferredMinimum = Math.min(360, maximumMinutes || 360);
    return splitLongPattern(pattern, dayStart, dayEnd, interval, preferredMinimum, maximumMinutes || 600);
  });

  return splitPatterns.sort((a, b) => a.start - b.start || a.layer - b.layer);
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
  const closes = state.shifts.filter((shift) => timeToMinutes(shift.shiftEnd.slice(11, 16)) >= 21 * 60).length;
  const weekends = state.shifts.filter((shift) => [0, 6].includes(weekday(shift.shiftStart.slice(0, 10)))).length;
  let score = targetGap * 2 + minimumGap * 5;
  if (profile.preferredDays.includes(weekday(date))) score += 18;
  if (profile.preferredStart && start >= timeToMinutes(profile.preferredStart)) score += 4;
  if (profile.preferredEnd && end <= timeToMinutes(profile.preferredEnd)) score += 4;
  if (requiredSkill && profileHasSkill(profile, requiredSkill)) score += 30;
  if (profile.payBasis === "salaried") score += 8;
  if (end >= 21 * 60) score -= closes * 5;
  if ([0, 6].includes(weekday(date))) score -= weekends * 3;
  score -= state.shifts.length * 1.5;
  score -= Math.min(12, profile.loadedHourlyRate / 3);
  return score;
}

function rejectionReason(states: StaffState[], pattern: ShiftPattern, date: string, minimumRestHours: number, existing: ExistingStaffShift[]) {
  const duration = pattern.end - pattern.start;
  const breakMinutes = duration >= 6 * 60 ? 30 : 0;
  const paidMinutes = duration - breakMinutes;
  const skilled = states.filter((state) => profileHasSkill(state.profile, pattern.requiredSkill));
  if (!skilled.length && pattern.requiredSkill) return `No active team member has the required ${pattern.requiredSkill} skill.`;
  const lengthEligible = skilled.filter((state) => duration >= state.profile.minimumShiftMinutes && duration <= state.profile.maximumShiftMinutes);
  if (!lengthEligible.length) return "No eligible person can work this shift length.";
  const hoursEligible = lengthEligible.filter((state) => state.assignedMinutes + paidMinutes <= state.profile.maximumWeeklyHours * 60);
  if (!hoursEligible.length) return "Every eligible person would exceed their maximum weekly hours.";
  const available = hoursEligible.filter((state) => availabilityAllows(state.profile, date, pattern.start, pattern.end));
  if (!available.length) return "No eligible person is available for the full shift window.";
  const startIso = dateTime(date, pattern.start);
  const endIso = dateTime(date, pattern.end);
  const rested = available.filter((state) => restAllows(state, startIso, endIso, minimumRestHours, existing));
  if (!rested.length) return "Every eligible person has a clash or minimum-rest breach.";
  return "No team member met every configured constraint.";
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
    const breakMinutes = duration >= 6 * 60 ? 30 : 0;
    const paidMinutes = duration - breakMinutes;
    const startIso = dateTime(input.date, pattern.start);
    const endIso = dateTime(input.date, pattern.end);
    const candidates = input.states.filter((state) => {
      const profile = state.profile;
      return duration >= profile.minimumShiftMinutes
        && duration <= profile.maximumShiftMinutes
        && state.assignedMinutes + paidMinutes <= profile.maximumWeeklyHours * 60
        && profileHasSkill(profile, pattern.requiredSkill)
        && availabilityAllows(profile, input.date, pattern.start, pattern.end)
        && consecutiveDays(state, input.date) <= profile.maximumConsecutiveDays
        && restAllows(state, startIso, endIso, input.minimumRestHours, input.existing);
    }).sort((a, b) => candidateScore(b, input.date, pattern.start, pattern.end, pattern.requiredSkill) - candidateScore(a, input.date, pattern.start, pattern.end, pattern.requiredSkill)
      || a.profile.staffName.localeCompare(b.profile.staffName));

    const selected = candidates[0];
    if (!selected) {
      const reason = rejectionReason(input.states, pattern, input.date, input.minimumRestHours, input.existing);
      warnings.push(`Unfilled ${minutesToTime(pattern.start)}–${minutesToTime(pattern.end)}${pattern.requiredSkill ? ` (${pattern.requiredSkill})` : ""}. ${reason}`);
      shifts.push({
        staffProfileId: null,
        staffName: "Unfilled shift",
        roleTitle: pattern.requiredSkill ?? "Cover required",
        shiftStart: startIso,
        shiftEnd: endIso,
        breakMinutes,
        paidMinutes,
        requiredSkill: pattern.requiredSkill,
        assignmentReason: reason,
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
      privateCost,
    };
    selected.assignedMinutes += paidMinutes;
    selected.shifts.push(shift);
    shifts.push(shift);
  }
  return { shifts, warnings };
}

function rebalanceMinimumHours(states: StaffState[], existing: ExistingStaffShift[], minimumRestHours: number) {
  const recipients = [...states].sort((a, b) => {
    const gapA = Math.max(0, a.profile.minimumWeeklyHours * 60 - a.assignedMinutes);
    const gapB = Math.max(0, b.profile.minimumWeeklyHours * 60 - b.assignedMinutes);
    return gapB - gapA;
  });

  for (const recipient of recipients) {
    let guard = 0;
    while (recipient.assignedMinutes + 1 < recipient.profile.minimumWeeklyHours * 60 && guard < 100) {
      guard += 1;
      const candidates = states.flatMap((donor) => donor === recipient ? [] : donor.shifts.map((shift) => ({ donor, shift })))
        .filter(({ donor, shift }) => donor.assignedMinutes - shift.paidMinutes >= donor.profile.minimumWeeklyHours * 60)
        .filter(({ shift }) => {
          const date = shift.shiftStart.slice(0, 10);
          const start = timeToMinutes(shift.shiftStart.slice(11, 16));
          const end = timeToMinutes(shift.shiftEnd.slice(11, 16));
          const duration = end - start;
          return duration >= recipient.profile.minimumShiftMinutes
            && duration <= recipient.profile.maximumShiftMinutes
            && recipient.assignedMinutes + shift.paidMinutes <= recipient.profile.maximumWeeklyHours * 60
            && profileHasSkill(recipient.profile, shift.requiredSkill)
            && availabilityAllows(recipient.profile, date, start, end)
            && consecutiveDays(recipient, date) <= recipient.profile.maximumConsecutiveDays
            && restAllows(recipient, shift.shiftStart, shift.shiftEnd, minimumRestHours, existing);
        })
        .sort((a, b) => {
          const donorSurplusA = a.donor.assignedMinutes - a.donor.profile.targetWeeklyHours * 60;
          const donorSurplusB = b.donor.assignedMinutes - b.donor.profile.targetWeeklyHours * 60;
          return donorSurplusB - donorSurplusA || a.shift.paidMinutes - b.shift.paidMinutes;
        });

      const move = candidates[0];
      if (!move) break;
      move.donor.shifts = move.donor.shifts.filter((shift) => shift !== move.shift);
      move.donor.assignedMinutes -= move.shift.paidMinutes;
      recipient.shifts.push(move.shift);
      recipient.assignedMinutes += move.shift.paidMinutes;
      move.shift.staffProfileId = recipient.profile.id;
      move.shift.staffName = recipient.profile.staffName;
      move.shift.roleTitle = recipient.profile.roleTitle || recipient.profile.primaryRole;
      move.shift.payBasis = recipient.profile.payBasis;
      move.shift.privateCost = recipient.profile.payBasis === "hourly" ? recipient.profile.loadedHourlyRate * move.shift.paidMinutes / 60 : 0;
      move.shift.assignmentReason = `Rebalanced to protect agreed hours · ${roundHours(recipient.assignedMinutes)}h projected this week`;
    }
  }
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
  const tradingForecasts = forecasts.filter((day) => ruleForDate(input.dayRules, day.businessDate)?.trading);
  const tradingDayCount = tradingForecasts.length || 1;
  const tradingForecastSales = sum(tradingForecasts.map((day) => day.forecastSales));
  const fixedWeeklyCost = sum(input.staff.map((staff) => staff.fixedWeeklyCost * staff.costAllocationPct / 100));
  const fixedDailyCost = fixedWeeklyCost / tradingDayCount;
  const salariedDailyHours = sum(input.staff
    .filter((staff) => staff.payBasis === "salaried")
    .map((staff) => staff.targetWeeklyHours * staff.costAllocationPct / 100)) / tradingDayCount;
  const committedWeeklyHours = sum(input.staff.map((staff) => staff.minimumWeeklyHours * staff.costAllocationPct / 100));
  const hourlyStaff = input.staff.filter((staff) => staff.payBasis === "hourly" && staff.loadedHourlyRate > 0);
  const blendedHourlyRate = hourlyStaff.length ? sum(hourlyStaff.map((staff) => staff.loadedHourlyRate)) / hourlyStaff.length : 0;
  const states: StaffState[] = input.staff.map((profile) => ({ profile, assignedMinutes: 0, shifts: [] }));
  const existing = input.existingShifts ?? [];
  const days: RotaPlanDay[] = [];

  for (const forecast of forecasts) {
    const rule = ruleForDate(input.dayRules, forecast.businessDate);
    if (!rule?.trading) continue;
    const open = timeToMinutes(rule.openTime) - rule.prepMinutes;
    const close = timeToMinutes(rule.closeTime) + rule.closeMinutes;
    const labourBudget = forecast.forecastSales * input.labourTargetPct / 100;
    const controllableBudget = Math.max(0, labourBudget - fixedDailyCost);
    const productivityHours = forecast.forecastSales / salesPerLabourHourTarget;
    const controllableHourlyHours = blendedHourlyRate > 0 ? controllableBudget / blendedHourlyRate : 0;
    const costAffordableHours = salariedDailyHours + controllableHourlyHours;
    const demandAndBudgetHours = Math.min(productivityHours, costAffordableHours);
    const forecastShare = tradingForecastSales > 0 ? forecast.forecastSales / tradingForecastSales : 1 / tradingDayCount;
    const committedDailyHours = committedWeeklyHours * forecastShare;
    const effectiveHours = Math.max(demandAndBudgetHours, committedDailyHours);
    const slots = coverageTargets(
      demandForDay(input.demand, weekday(forecast.businessDate), open, close, intervalMinutes),
      rule,
      effectiveHours,
    );
    const patterns = patternsFromCoverage(slots, rule, input.staff, intervalMinutes);
    const assigned = assignPatterns({ date: forecast.businessDate, patterns, states, existing, minimumRestHours });
    const coverage = coverageActual(slots, assigned.shifts);
    const peak = [...slots].sort((a, b) => b.weight - a.weight)[0];
    const dayWarnings = [...assigned.warnings];
    if (forecast.historyValues.length < minimumHistoryWeeks) dayWarnings.push(`Only ${forecast.historyValues.length} comparable ${new Date(`${forecast.businessDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}s are available; treat this as indicative.`);
    if (coverage.some((slot) => slot.assigned < slot.required)) dayWarnings.push("One or more day-parts remain below the suggested coverage level.");
    days.push({
      businessDate: forecast.businessDate,
      forecastSales: forecast.forecastSales,
      forecastLow: forecast.low,
      forecastHigh: forecast.high,
      labourBudget: roundMoney(labourBudget),
      fixedLabourCost: roundMoney(fixedDailyCost),
      controllableBudget: roundMoney(controllableBudget),
      plannedCost: 0,
      plannedHours: 0,
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
        committedHoursFloor: Math.round(committedDailyHours * 100) / 100,
        salariedCoverageHours: Math.round(salariedDailyHours * 100) / 100,
        controllableHourlyHours: Math.round(controllableHourlyHours * 100) / 100,
        demandSource: input.demand.some((point) => point.weekday === weekday(forecast.businessDate) && point.source === "hourly_sales") ? "hourly sales" : "editable day-part template",
      },
      warnings: dayWarnings,
      shifts: assigned.shifts,
    });
  }

  rebalanceMinimumHours(states, existing, minimumRestHours);

  for (const day of days) {
    const hourlyCost = sum(day.shifts.map((shift) => shift.privateCost));
    day.plannedCost = roundMoney(day.fixedLabourCost + hourlyCost);
    day.plannedHours = roundHours(sum(day.shifts.filter((shift) => shift.staffProfileId).map((shift) => shift.paidMinutes)));
    if (day.plannedCost > day.labourBudget * 1.02) {
      day.warnings.push(`Planned labour is ${roundMoney(day.plannedCost - day.labourBudget).toFixed(2)} over the target budget because agreed hours, minimum coverage or staff constraints take priority.`);
    }
    day.warnings = [...new Set(day.warnings)];
  }

  const planWarnings = days.flatMap((day) => day.warnings.map((warning) => `${day.businessDate}: ${warning}`));
  for (const state of states) {
    const hours = state.assignedMinutes / 60;
    if (hours + 0.01 < state.profile.minimumWeeklyHours) {
      planWarnings.push(`${state.profile.staffName} is ${roundHours(state.profile.minimumWeeklyHours * 60 - state.assignedMinutes)}h below their agreed minimum hours.`);
    }
    if (hours > state.profile.maximumWeeklyHours + 0.01) {
      planWarnings.push(`${state.profile.staffName} exceeds their configured maximum weekly hours.`);
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
    explanation: `Forecast uses up to ${forecastWeeks} matching weekdays with recent weeks weighted most heavily; ${within}. The planner first protects minimum cover and agreed hours, then places extra cover into the busiest periods. Long generic coverage blocks are split into practical shifts before staff are assigned within availability, rest, skill and weekly-hour limits.`,
    warnings: [...new Set(planWarnings)],
    days,
  };
}

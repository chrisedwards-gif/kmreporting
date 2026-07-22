import type { DemandPoint, ForecastDay, ForecastEvent, HistoricalSalesDay } from "@/lib/rota/types";

const DAY_MS = 86_400_000;
const WEIGHTS = [0.28, 0.22, 0.17, 0.13, 0.09, 0.06, 0.03, 0.02];

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00Z`);
const weekday = (value: string) => dateAtNoon(value).getUTCDay();

export function addDays(value: string, days: number) {
  return new Date(dateAtNoon(value).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export type HourlySalesRow = {
  businessDate: string;
  slotTime: string;
  netSales: number;
};

const minutesFromTime = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const timeFromMinutes = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

/**
 * Builds a typical trading-day shape from actual intraday sales. Each day's
 * sales are normalised before averaging so a one-off high-value event cannot
 * dominate the staffing curve. Explicit manual curves always win.
 */
export function buildDemandCurve(input: {
  rows: HourlySalesRow[];
  fallback: DemandPoint[];
  intervalMinutes: number;
  minimumHistoryWeeks: number;
}): DemandPoint[] {
  const byWeekday = new Map<number, Map<string, Map<string, number>>>();
  for (const row of input.rows) {
    if (row.netSales <= 0) continue;
    const day = weekday(row.businessDate);
    const bucket = Math.floor(minutesFromTime(row.slotTime) / input.intervalMinutes) * input.intervalMinutes;
    const dates = byWeekday.get(day) ?? new Map<string, Map<string, number>>();
    const slots = dates.get(row.businessDate) ?? new Map<string, number>();
    const slotTime = timeFromMinutes(bucket);
    slots.set(slotTime, (slots.get(slotTime) ?? 0) + row.netSales);
    dates.set(row.businessDate, slots);
    byWeekday.set(day, dates);
  }

  const result: DemandPoint[] = [];
  for (let day = 0; day < 7; day += 1) {
    const fallback = input.fallback.filter((point) => point.weekday === day);
    if (fallback.some((point) => point.source === "manual")) {
      result.push(...fallback);
      continue;
    }

    const dates = byWeekday.get(day);
    if (!dates || dates.size < input.minimumHistoryWeeks) {
      result.push(...fallback);
      continue;
    }

    const averageShares = new Map<string, number>();
    for (const slots of dates.values()) {
      const dailyTotal = [...slots.values()].reduce((sum, value) => sum + value, 0);
      if (!dailyTotal) continue;
      for (const [slotTime, value] of slots) {
        averageShares.set(slotTime, (averageShares.get(slotTime) ?? 0) + value / dailyTotal / dates.size);
      }
    }
    const totalShare = [...averageShares.values()].reduce((sum, value) => sum + value, 0);
    if (!totalShare) {
      result.push(...fallback);
      continue;
    }
    for (const [slotTime, share] of averageShares) {
      result.push({ weekday: day, slotTime, demandWeight: share / totalShare, source: "hourly_sales" });
    }
  }
  return result.sort((a, b) => a.weekday - b.weekday || a.slotTime.localeCompare(b.slotTime));
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function excludeOutliers(values: number[]) {
  if (values.length < 5) return { included: values, excluded: [] as number[] };
  const centre = median(values);
  const deviations = values.map((value) => Math.abs(value - centre));
  const mad = median(deviations);
  if (mad === 0) return { included: values, excluded: [] as number[] };
  const threshold = 3.5 * 1.4826 * mad;
  return {
    included: values.filter((value) => Math.abs(value - centre) <= threshold),
    excluded: values.filter((value) => Math.abs(value - centre) > threshold),
  };
}

function weightedMean(values: number[]) {
  const weights = WEIGHTS.slice(0, values.length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return totalWeight ? values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight : 0;
}

function sampleDeviation(values: number[], centre: number) {
  if (values.length < 2) return centre * 0.1;
  const variance = values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function historyForDate(history: HistoricalSalesDay[], businessDate: string, limit: number) {
  const targetTime = dateAtNoon(businessDate).getTime();
  const targetWeekday = weekday(businessDate);
  return history
    .filter((day) => day.netSales > 0 && weekday(day.businessDate) === targetWeekday && dateAtNoon(day.businessDate).getTime() < targetTime)
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    .slice(0, limit)
    .map((day) => day.netSales);
}

function trendAdjustment(values: number[]) {
  if (values.length < 6) return 0;
  const recent = values.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  const priorValues = values.slice(3, 6);
  const prior = priorValues.reduce((sum, value) => sum + value, 0) / priorValues.length;
  if (!prior) return 0;
  return Math.max(-0.15, Math.min(0.15, (recent - prior) / prior)) * 0.35;
}

function confidenceFor(points: number, relativeSpread: number, minimumHistoryWeeks: number): ForecastDay["confidence"] {
  if (points < minimumHistoryWeeks) return "building_history";
  if (points >= 7 && relativeSpread <= 0.12) return "high";
  if (points >= 5 && relativeSpread <= 0.22) return "medium";
  return "low";
}

export function forecastDay(input: {
  businessDate: string;
  history: HistoricalSalesDay[];
  events: ForecastEvent[];
  forecastWeeks: number;
  minimumHistoryWeeks: number;
}): ForecastDay {
  const rawValues = historyForDate(input.history, input.businessDate, input.forecastWeeks);
  const { included, excluded } = excludeOutliers(rawValues);
  const usable = included.length ? included : rawValues;
  const unadjusted = weightedMean(usable);
  const baseForecast = unadjusted * (1 + trendAdjustment(usable));
  const eventUpliftPct = input.events
    .filter((event) => event.eventDate === input.businessDate)
    .reduce((sum, event) => sum + event.salesUpliftPct, 0);
  const forecastSales = Math.max(0, baseForecast * (1 + eventUpliftPct / 100));
  const deviation = sampleDeviation(usable, unadjusted || forecastSales);
  const band = Math.max(forecastSales * 0.08, deviation * 1.28);
  const relativeSpread = forecastSales ? band / forecastSales : 1;
  return {
    businessDate: input.businessDate,
    forecastSales: roundMoney(forecastSales),
    low: roundMoney(Math.max(0, forecastSales - band)),
    high: roundMoney(forecastSales + band),
    baseForecast: roundMoney(baseForecast),
    eventUpliftPct,
    historyValues: usable.map(roundMoney),
    excludedValues: excluded.map(roundMoney),
    confidence: confidenceFor(usable.length, relativeSpread, input.minimumHistoryWeeks),
  };
}

export function backtestForecast(history: HistoricalSalesDay[], forecastWeeks = 8, minimumHistoryWeeks = 4) {
  const sorted = history.filter((day) => day.netSales > 0).sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const errors: number[] = [];
  for (const actual of sorted) {
    const prior = historyForDate(sorted, actual.businessDate, forecastWeeks);
    if (prior.length < minimumHistoryWeeks) continue;
    const predicted = forecastDay({
      businessDate: actual.businessDate,
      history: sorted.filter((day) => day.businessDate < actual.businessDate),
      events: [],
      forecastWeeks,
      minimumHistoryWeeks,
    }).forecastSales;
    if (predicted > 0) errors.push(Math.abs(actual.netSales - predicted) / actual.netSales * 100);
  }
  if (!errors.length) return null;
  const sortedErrors = errors.sort((a, b) => a - b);
  const trimmed = sortedErrors.length >= 10 ? sortedErrors.slice(1, -1) : sortedErrors;
  return Math.round(trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length * 10) / 10;
}

export function overallConfidence(days: ForecastDay[], mape: number | null): ForecastDay["confidence"] {
  if (days.some((day) => day.confidence === "building_history")) return "building_history";
  if (mape === null) return "low";
  if (mape <= 10 && days.every((day) => day.confidence === "high" || day.confidence === "medium")) return "high";
  if (mape <= 18) return "medium";
  return "low";
}

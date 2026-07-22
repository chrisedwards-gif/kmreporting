import { describe, expect, it } from "vitest";
import { addDays, backtestForecast, buildDemandCurve, forecastDay } from "@/lib/rota/forecasting";

describe("rota sales forecasting", () => {
  it("weights matching weekdays, removes a one-off outlier and applies a named event", () => {
    const target = "2026-07-25";
    const normal = [3000, 2920, 3050, 2980, 3010, 9000, 2950, 3030];
    const history = normal.map((netSales, index) => ({ businessDate: addDays(target, -(index + 1) * 7), netSales }));
    const result = forecastDay({ businessDate: target, history, events: [{ eventDate: target, title: "Local event", salesUpliftPct: 10, source: "manual" }], forecastWeeks: 8, minimumHistoryWeeks: 4 });

    expect(result.excludedValues).toContain(9000);
    expect(result.baseForecast).toBeGreaterThan(2900);
    expect(result.baseForecast).toBeLessThan(3100);
    expect(result.forecastSales).toBeCloseTo(result.baseForecast * 1.1, 1);
    expect(result.historyValues).toHaveLength(7);
  });

  it("reports real backtest error rather than inventing confidence", () => {
    const history = Array.from({ length: 14 }, (_, week) => ({ businessDate: addDays("2026-07-25", -week * 7), netSales: 3000 + (week % 2 ? 60 : -60) }));
    const mape = backtestForecast(history, 8, 4);
    expect(mape).not.toBeNull();
    expect(mape!).toBeLessThan(5);
  });

  it("learns an interval-aligned demand curve from actual hourly sales", () => {
    const fallback = [
      { weekday: 6, slotTime: "12:00", demandWeight: 0.5, source: "template" as const },
      { weekday: 6, slotTime: "17:00", demandWeight: 0.5, source: "template" as const },
    ];
    const rows = ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"].flatMap((businessDate) => [
      { businessDate, slotTime: "12:00", netSales: 100 },
      { businessDate, slotTime: "12:30", netSales: 100 },
      { businessDate, slotTime: "17:00", netSales: 600 },
    ]);
    const result = buildDemandCurve({ rows, fallback, intervalMinutes: 60, minimumHistoryWeeks: 4 });

    expect(result).toEqual([
      { weekday: 6, slotTime: "12:00", demandWeight: 0.25, source: "hourly_sales" },
      { weekday: 6, slotTime: "17:00", demandWeight: 0.75, source: "hourly_sales" },
    ]);
  });

  it("keeps a manual demand curve even when hourly history exists", () => {
    const fallback = [{ weekday: 6, slotTime: "17:00", demandWeight: 1, source: "manual" as const }];
    const rows = ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"].map((businessDate) => ({ businessDate, slotTime: "12:00", netSales: 100 }));
    expect(buildDemandCurve({ rows, fallback, intervalMinutes: 60, minimumHistoryWeeks: 4 })).toEqual(fallback);
  });
});

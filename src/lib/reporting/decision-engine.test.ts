import { describe, expect, it } from "vitest";
import { buildDecisionSignals, type DecisionEngineInput } from "@/lib/reporting/decision-engine";

const siteId = "site-a";
const siteName = "Kardia";

const base: DecisionEngineInput = { weeks: [], products: [], hourlySales: [], dailyLabour: [], reconciliations: [] };

function week(weekStart: string, netSales: number, overrides: Partial<DecisionEngineInput["weeks"][number]> = {}) {
  return {
    siteId,
    siteName,
    weekStart,
    netSales,
    foodCostPct: 30,
    labourPct: 30,
    wastePct: 1,
    foodCostTarget: 30,
    labourTarget: 32,
    wasteTarget: 1.2,
    ...overrides,
  };
}

describe("buildDecisionSignals", () => {
  it("flags sustained sales movement against the recent run-rate", () => {
    const signals = buildDecisionSignals({
      ...base,
      weeks: [week("2026-08-09", 10000), week("2026-08-16", 10200), week("2026-08-23", 9800), week("2026-08-30", 10000), week("2026-09-06", 12000)],
    });
    expect(signals.some((signal) => signal.category === "sales" && signal.severity === "opportunity")).toBe(true);
  });

  it("turns a target gap into a quantified labour opportunity", () => {
    const signals = buildDecisionSignals({
      ...base,
      weeks: [week("2026-09-06", 10000, { labourPct: 36, labourTarget: 32 })],
    });
    const labour = signals.find((signal) => signal.key.startsWith("labour-target"));
    expect(labour?.estimatedWeeklyImpact).toBe(400);
    expect(labour?.recommendation).toContain("hourly demand");
  });

  it("requires repeated weak product evidence before suggesting a menu review", () => {
    const weekStarts = ["2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06"];
    const products = weekStarts.flatMap((weekStart) => [
      { siteId, siteName, weekStart, itemName: "Hero Gyros", category: "Flatbreads", quantity: 100, netSales: 1200 },
      { siteId, siteName, weekStart, itemName: "Slow Dish", category: "Small Plates", quantity: 2, netSales: 20 },
    ]);
    const signals = buildDecisionSignals({ ...base, products });
    const menu = signals.find((signal) => signal.title.includes("Slow Dish"));
    expect(menu?.category).toBe("menu");
    expect(menu?.finding).toContain("4 of the last 4");
  });

  it("identifies recurring peak demand only after repeated hourly samples", () => {
    const dates = ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04"];
    const hourlySales = dates.flatMap((businessDate) => [
      { siteId, siteName, businessDate, slotTime: "12:00:00", netSales: 100, transactions: 10, covers: 0 },
      { siteId, siteName, businessDate, slotTime: "13:00:00", netSales: 120, transactions: 11, covers: 0 },
      { siteId, siteName, businessDate, slotTime: "18:00:00", netSales: 500, transactions: 30, covers: 0 },
      { siteId, siteName, businessDate, slotTime: "19:00:00", netSales: 420, transactions: 25, covers: 0 },
      { siteId, siteName, businessDate, slotTime: "21:00:00", netSales: 40, transactions: 4, covers: 0 },
    ]);
    const signals = buildDecisionSignals({ ...base, hourlySales });
    expect(signals.some((signal) => signal.key.startsWith("peak-demand") && signal.title.includes("18:00"))).toBe(true);
  });
});

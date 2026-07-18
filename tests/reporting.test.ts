import { describe, expect, it } from "vitest";
import { calculateCosts } from "@/lib/reporting/calculations";
import { getLatestCompletedReportingWeek, isMondayToSunday } from "@/lib/reporting/periods";
import { buildReviewFlags } from "@/lib/reporting/review";

describe("weekly reporting calculations", () => {
  it("calculates COGS and staff cost without exposing individual pay", () => {
    const result = calculateCosts({
      netSales: 50_000,
      openingStock: 6_000,
      purchases: 15_000,
      credits: 500,
      transfersIn: 400,
      transfersOut: 250,
      closingStock: 5_650,
      adjustments: 0,
      paidHours: 900,
      averageLoadedRate: 16,
      agencyCost: 1_200,
      overtimePremium: 350,
      wasteCost: 550,
    });

    expect(result.cogs).toBe(15_000);
    expect(result.foodCostPct).toBe(30);
    expect(result.staffCost).toBe(15_950);
    expect(result.labourPct).toBeCloseTo(31.9);
    expect(result.primeCost).toBe(30_950);
  });

  it("requires a Monday-to-Sunday seven-day period", () => {
    expect(isMondayToSunday("2026-07-06", "2026-07-12")).toBe(true);
    expect(isMondayToSunday("2026-07-07", "2026-07-13")).toBe(false);
    expect(isMondayToSunday("2026-07-06", "2026-07-13")).toBe(false);
  });

  it("defaults new reports to the latest completed Monday-to-Sunday week", () => {
    expect(getLatestCompletedReportingWeek(new Date("2026-07-18T10:00:00Z"))).toMatchObject({
      start: "2026-07-06",
      end: "2026-07-12",
    });
    expect(getLatestCompletedReportingWeek(new Date("2026-07-20T10:00:00Z"))).toMatchObject({
      start: "2026-07-13",
      end: "2026-07-19",
    });
  });

  it("raises cost and compliance review gates", () => {
    const flags = buildReviewFlags(
      {
        cogs: 17_000,
        foodCostPct: 34,
        staffCost: 17_500,
        labourPct: 35,
        wastePct: 1.4,
        primeCost: 34_500,
        primeCostPct: 69,
      },
      { foodCostTarget: 31, labourTarget: 32, wasteTarget: 1 },
      { complianceIssues: "Fridge log gap" },
    );

    expect(flags.map((flag) => flag.code)).toEqual([
      "FOOD_COST_OVER_TARGET",
      "LABOUR_OVER_TARGET",
      "WASTE_OVER_TARGET",
      "COMPLIANCE_REVIEW",
    ]);
  });
});

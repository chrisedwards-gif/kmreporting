import { describe, expect, it } from "vitest";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { visibleRotaPlan } from "@/lib/rota/visibility";

const plan = {
  id: "plan-1",
  version: 1,
  status: "suggested",
  weekStart: "2026-07-27",
  weekEnd: "2026-08-02",
  forecastSales: 10000,
  forecastLow: 9000,
  forecastHigh: 11000,
  labourTargetPct: 30,
  labourBudget: 3000,
  plannedCost: 2500,
  plannedHours: 160,
  accuracyMape: 8,
  confidence: "high",
  explanation: "Full private labour plan.",
  warnings: ["Fixed labour cost is included.", "One shift is unfilled."],
  days: [{
    businessDate: "2026-07-27",
    forecastSales: 10000,
    forecastLow: 9000,
    forecastHigh: 11000,
    labourBudget: 3000,
    fixedLabourCost: 700,
    controllableBudget: 2300,
    plannedCost: 2500,
    plannedHours: 160,
    peakTime: "18:00",
    coverage: [{ slotTime: "18:00", required: 3, assigned: 3, demandWeight: 20 }],
    evidence: {
      salariedCoverageHours: 40,
      annualSalary: 35000,
      controllableHourlyHours: 120,
    },
    warnings: ["Salaried cover is included.", "One shift is unfilled."],
    shifts: [{
      staffProfileId: "staff-1",
      staffName: "Manager",
      roleTitle: "Kitchen Manager",
      shiftStart: "2026-07-27T10:00:00+01:00",
      shiftEnd: "2026-07-27T18:00:00+01:00",
      breakMinutes: 30,
      paidMinutes: 450,
      requiredSkill: "kitchen manager",
      assignmentReason: "Required cover",
      payBasis: "salaried",
      privateCost: 700,
    }],
  }],
} satisfies StoredRotaPlan;

describe("rota finance visibility", () => {
  it("removes salary allocation and private cost from kitchen-manager plans", () => {
    const visible = visibleRotaPlan(plan, "hourly_only");

    expect(visible.days[0].fixedLabourCost).toBe(0);
    expect(visible.days[0].plannedCost).toBe(1800);
    expect(visible.days[0].labourBudget).toBe(2300);
    expect(visible.plannedCost).toBe(1800);
    expect(visible.labourBudget).toBe(2300);
    expect(visible.days[0].shifts[0].privateCost).toBe(0);
    expect(visible.days[0].evidence).not.toHaveProperty("annualSalary");
    expect(visible.days[0].evidence).not.toHaveProperty("salariedCoverageHours");
    expect(visible.warnings).toEqual(["One shift is unfilled."]);
    expect(visible.days[0].warnings).toEqual(["One shift is unfilled."]);
  });

  it("leaves the full management plan unchanged", () => {
    expect(visibleRotaPlan(plan, "full")).toBe(plan);
  });
});

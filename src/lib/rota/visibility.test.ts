import { describe, expect, it } from "vitest";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { RotaStaffProfile } from "@/lib/rota/types";
import { visibleRotaPlan, visibleRotaStaff } from "@/lib/rota/visibility";
import { createRotaWarning } from "@/lib/rota/warnings";

const privateWarning = "Committed leadership allocation exceeds the allowance.";
const operationalWarning = "One shift is unfilled.";

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
  warnings: [
    createRotaWarning(privateWarning, "management"),
    createRotaWarning(operationalWarning, "all"),
  ],
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
    warnings: [
      createRotaWarning(privateWarning, "management"),
      createRotaWarning(operationalWarning, "all"),
    ],
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

const staff = (input: Partial<RotaStaffProfile> & Pick<RotaStaffProfile, "id" | "staffName" | "primaryRole" | "roleRank" | "displayOrder">): RotaStaffProfile => ({
  appProfileId: null,
  employeeRef: input.id,
  rotacloudUserId: null,
  roleTitle: input.primaryRole,
  organisationWide: false,
  skills: [],
  minimumWeeklyHours: 0,
  targetWeeklyHours: 40,
  maximumWeeklyHours: 48,
  minimumShiftMinutes: 240,
  maximumShiftMinutes: 720,
  maximumConsecutiveDays: 6,
  preferredDays: [1, 2, 3, 4, 5],
  preferredStart: null,
  preferredEnd: null,
  payBasis: "hourly",
  loadedHourlyRate: 14,
  fixedWeeklyCost: 0,
  costAllocationPct: 100,
  ...input,
});

describe("rota finance visibility", () => {
  it("removes salary allocation, private cost and management-only warnings from kitchen-manager plans", () => {
    const visible = visibleRotaPlan(plan, "hourly_only");

    expect(visible.days[0].fixedLabourCost).toBe(0);
    expect(visible.days[0].plannedCost).toBe(1800);
    expect(visible.days[0].labourBudget).toBe(2300);
    expect(visible.plannedCost).toBe(1800);
    expect(visible.labourBudget).toBe(2300);
    expect(visible.days[0].shifts[0].privateCost).toBe(0);
    expect(visible.days[0].evidence).not.toHaveProperty("annualSalary");
    expect(visible.days[0].evidence).not.toHaveProperty("salariedCoverageHours");
    expect(visible.warnings).toEqual([operationalWarning]);
    expect(visible.days[0].warnings).toEqual([operationalWarning]);
  });

  it("shows management warnings without exposing their internal tags", () => {
    const visible = visibleRotaPlan(plan, "full");

    expect(visible.plannedCost).toBe(plan.plannedCost);
    expect(visible.days[0].fixedLabourCost).toBe(700);
    expect(visible.warnings).toEqual([privateWarning, operationalWarning]);
    expect(visible.days[0].warnings).toEqual([privateWarning, operationalWarning]);
  });

  it("sorts by rank and person order while retaining the linked account UUID", () => {
    const visible = visibleRotaStaff([
      staff({ id: "00000000-0000-4000-8000-000000000003", staffName: "Warren", primaryRole: "Kitchen Manager", roleRank: 200, displayOrder: 20 }),
      staff({ id: "00000000-0000-4000-8000-000000000001", appProfileId: "00000000-0000-4000-9000-000000000001", staffName: "Chris", primaryRole: "Group Chef", roleRank: 100, displayOrder: 10, organisationWide: true, payBasis: "salaried", loadedHourlyRate: 31, fixedWeeklyCost: 1200 }),
      staff({ id: "00000000-0000-4000-8000-000000000002", staffName: "Scott", primaryRole: "Kitchen Manager", roleRank: 200, displayOrder: 10, payBasis: "salaried", loadedHourlyRate: 20, fixedWeeklyCost: 700 }),
    ]);

    expect(visible.map((person) => person.name)).toEqual(["Chris", "Scott", "Warren"]);
    expect(visible[0].appProfileId).toBe("00000000-0000-4000-9000-000000000001");
    expect(visible[0].organisationWide).toBe(true);
    expect(visible[0].hourlyRate).toBeNull();
    expect(visible[1].hourlyRate).toBeNull();
    expect(visible[2].hourlyRate).toBe(14);
  });
});

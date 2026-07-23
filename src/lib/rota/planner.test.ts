import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/rota/forecasting";
import { buildRotaPlan } from "@/lib/rota/planner";
import type { RotaPlanningInput, RotaStaffProfile } from "@/lib/rota/types";

const weekStart = "2026-07-20";

const profile = (id: string, staffName: string, role: string, overrides: Partial<RotaStaffProfile> = {}): RotaStaffProfile => ({
  id,
  appProfileId: null,
  employeeRef: id,
  rotacloudUserId: null,
  staffName,
  primaryRole: role,
  roleTitle: role,
  roleRank: role.toLowerCase().includes("manager") ? 200 : 300,
  displayOrder: 10,
  organisationWide: false,
  skills: [role.toLowerCase()],
  minimumWeeklyHours: 0,
  targetWeeklyHours: 40,
  maximumWeeklyHours: 48,
  minimumShiftMinutes: 240,
  maximumShiftMinutes: 720,
  maximumConsecutiveDays: 6,
  preferredDays: [1, 2, 3, 4, 5, 6],
  preferredStart: "10:00",
  preferredEnd: "22:00",
  payBasis: "hourly",
  loadedHourlyRate: 14.1,
  fixedWeeklyCost: 0,
  costAllocationPct: 100,
  ...overrides,
});

function saturdayInput(staff: RotaStaffProfile[]): RotaPlanningInput {
  const history = Array.from({ length: 10 }, (_, index) => ({ businessDate: addDays("2026-07-25", -(index + 1) * 7), netSales: 3000 }));
  return {
    weekStart, labourTargetPct: 28, history, events: [], staff, forecastWeeks: 8, minimumHistoryWeeks: 4, intervalMinutes: 60,
    salesPerLabourHourTarget: 100,
    dayRules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: "10:00", closeTime: "22:00", prepMinutes: 0, closeMinutes: 0, minimumStaff: 2, maximumStaff: 3, requiredSkills: weekday === 6 ? ["kitchen manager"] : [], trading: weekday === 6 })),
    demand: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour, index) => ({ weekday: 6, slotTime: `${hour}:00`, demandWeight: [.02, .03, .06, .08, .05, .04, .07, .18, .16, .14, .1, .07][index], source: "template" })),
  };
}

const shiftMinutes = (start: string, end: string) => (new Date(end).getTime() - new Date(start).getTime()) / 60_000;

describe("rota planner", () => {
  it("turns a £3,000 Saturday into a £840 labour envelope and puts extra cover at peak", () => {
    const staff = [
      profile("00000000-0000-4000-8000-000000000001", "Scott", "Kitchen Manager", { payBasis: "salaried", fixedWeeklyCost: 417, loadedHourlyRate: 16 }),
      profile("00000000-0000-4000-8000-000000000002", "Bhavya", "Pizzaiolo"),
      profile("00000000-0000-4000-8000-000000000003", "Finlay", "Pizzaiolo"),
      profile("00000000-0000-4000-8000-000000000004", "Owen", "Pizzaiolo"),
    ];
    const plan = buildRotaPlan(saturdayInput(staff));
    const saturday = plan.days[0];
    const peakCover = saturday.coverage.find((slot) => slot.slotTime === "17:00")!.required;
    const openingCover = saturday.coverage.find((slot) => slot.slotTime === "10:00")!.required;

    expect(plan.forecastSales).toBe(3000);
    expect(plan.labourBudget).toBe(840);
    expect(saturday.fixedLabourCost).toBe(417);
    expect(saturday.controllableBudget).toBe(423);
    expect(saturday.peakTime).toBe("17:00");
    expect(peakCover).toBe(3);
    expect(openingCover).toBeGreaterThanOrEqual(2);
    expect(peakCover).toBeGreaterThanOrEqual(openingCover);
    expect(saturday.shifts.some((shift) => shift.requiredSkill === "kitchen manager")).toBe(true);
    expect(saturday.plannedCost).toBeLessThanOrEqual(840);
  });

  it("splits long generic coverage into practical six-to-ten-hour shifts", () => {
    const staff = [
      profile("00000000-0000-4000-8000-000000000001", "Scott", "Kitchen Manager", { payBasis: "salaried", fixedWeeklyCost: 417, loadedHourlyRate: 16 }),
      profile("00000000-0000-4000-8000-000000000002", "Bhavya", "Pizzaiolo", { maximumShiftMinutes: 600 }),
      profile("00000000-0000-4000-8000-000000000003", "Finlay", "Pizzaiolo", { maximumShiftMinutes: 600 }),
      profile("00000000-0000-4000-8000-000000000004", "Owen", "Pizzaiolo", { maximumShiftMinutes: 600 }),
    ];
    const saturday = buildRotaPlan(saturdayInput(staff)).days[0];
    const generic = saturday.shifts.filter((shift) => shift.staffProfileId && !shift.requiredSkill);

    expect(generic.length).toBeGreaterThanOrEqual(2);
    expect(generic.every((shift) => {
      const minutes = shiftMinutes(shift.shiftStart, shift.shiftEnd);
      return minutes >= 360 && minutes <= 600;
    })).toBe(true);
  });

  it("uses agreed minimum hours as a planning floor when demand and budget would schedule less", () => {
    const staff = [
      profile("00000000-0000-4000-8000-000000000001", "Bhavya", "Pizzaiolo", { minimumWeeklyHours: 6, targetWeeklyHours: 8 }),
      profile("00000000-0000-4000-8000-000000000002", "Finlay", "Pizzaiolo", { minimumWeeklyHours: 6, targetWeeklyHours: 8 }),
      profile("00000000-0000-4000-8000-000000000003", "Owen", "Pizzaiolo", { minimumWeeklyHours: 6, targetWeeklyHours: 8 }),
    ];
    const input = saturdayInput(staff);
    input.history = Array.from({ length: 10 }, (_, index) => ({ businessDate: addDays("2026-07-25", -(index + 1) * 7), netSales: 500 }));
    input.dayRules = input.dayRules.map((rule) => ({ ...rule, minimumStaff: 1, maximumStaff: 3, requiredSkills: [] }));
    const saturday = buildRotaPlan(input).days[0];

    expect(saturday.evidence.committedHoursFloor).toBe(18);
    expect(saturday.evidence.targetStaffHours).toBe(18);
  });

  it("uses the controllable budget—not the full labour envelope—to buy hourly cover", () => {
    const salariedManager = profile("00000000-0000-4000-8000-000000000001", "Scott", "Kitchen Manager", {
      payBasis: "salaried",
      fixedWeeklyCost: 417,
      loadedHourlyRate: 16,
      targetWeeklyHours: 8,
    });
    const input = saturdayInput([
      salariedManager,
      profile("00000000-0000-4000-8000-000000000002", "Bhavya", "Pizzaiolo"),
      profile("00000000-0000-4000-8000-000000000003", "Finlay", "Pizzaiolo"),
      profile("00000000-0000-4000-8000-000000000004", "Owen", "Pizzaiolo"),
      profile("00000000-0000-4000-8000-000000000005", "Logan", "Pizzaiolo"),
    ]);
    input.salesPerLabourHourTarget = 50;
    input.dayRules = input.dayRules.map((rule) => ({ ...rule, maximumStaff: 5 }));

    const saturday = buildRotaPlan(input).days[0];

    expect(saturday.controllableBudget).toBe(423);
    expect(saturday.evidence.salariedCoverageHours).toBe(8);
    expect(saturday.evidence.controllableHourlyHours).toBe(30);
    expect(saturday.evidence.targetStaffHours).toBe(38);
  });

  it("never fills a shift with someone unavailable or missing the required skill", () => {
    const unavailableManager = profile("00000000-0000-4000-8000-000000000001", "Scott", "Kitchen Manager", {
      availability: [{ date: "2026-07-25", available: [], unavailable: [{ startTime: "00:00", endTime: "00:00" }] }],
    });
    const cooks = [profile("00000000-0000-4000-8000-000000000002", "Bhavya", "Pizzaiolo"), profile("00000000-0000-4000-8000-000000000003", "Finlay", "Pizzaiolo")];
    const saturday = buildRotaPlan(saturdayInput([unavailableManager, ...cooks])).days[0];
    const requiredManager = saturday.shifts.find((shift) => shift.requiredSkill === "kitchen manager");
    expect(requiredManager?.staffProfileId).toBeNull();
    expect(saturday.warnings.some((warning) => warning.includes("Unfilled"))).toBe(true);
  });

  it("respects an existing cross-site shift and minimum rest", () => {
    const manager = profile("00000000-0000-4000-8000-000000000001", "Scott", "Kitchen Manager");
    const input = saturdayInput([manager, profile("00000000-0000-4000-8000-000000000002", "Bhavya", "Pizzaiolo"), profile("00000000-0000-4000-8000-000000000003", "Finlay", "Pizzaiolo")]);
    input.existingShifts = [{ staffProfileId: manager.id, shiftStart: "2026-07-25T09:00:00+01:00", shiftEnd: "2026-07-25T17:00:00+01:00" }];
    const saturday = buildRotaPlan(input).days[0];
    expect(saturday.shifts.find((shift) => shift.requiredSkill === "kitchen manager")?.staffProfileId).toBeNull();
  });
});

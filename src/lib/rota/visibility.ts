import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { RotaStaffProfile } from "@/lib/rota/types";

export type RotaFinanceVisibility = "full" | "hourly_only";

export type RotaDisplayStaff = {
  id: string;
  name: string;
  role: string;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
  payBasis: "hourly" | "salaried";
};

const privateCostWarning = /(salary|salaried|fixed labour|fixed cost|annual pay)/i;

export function visibleRotaStaff(staff: RotaStaffProfile[]): RotaDisplayStaff[] {
  return staff.map((person) => ({
    id: person.id,
    name: person.staffName,
    role: person.roleTitle || person.primaryRole || "Team",
    minimumHours: person.minimumWeeklyHours,
    targetHours: person.targetWeeklyHours,
    maximumHours: person.maximumWeeklyHours,
    payBasis: person.payBasis,
  }));
}

export function visibleRotaPlan(
  plan: StoredRotaPlan,
  visibility: RotaFinanceVisibility,
): StoredRotaPlan {
  if (visibility === "full") return plan;

  const days = plan.days.map((day) => {
    const evidence = { ...day.evidence };
    delete evidence.salariedCoverageHours;
    delete evidence.fixedWeeklyCost;
    delete evidence.fixedDailyCost;
    delete evidence.annualSalary;
    delete evidence.salaryCost;

    const hourlyCost = Math.max(0, day.plannedCost - day.fixedLabourCost);
    return {
      ...day,
      labourBudget: day.controllableBudget,
      fixedLabourCost: 0,
      plannedCost: hourlyCost,
      evidence,
      warnings: day.warnings.filter((warning) => !privateCostWarning.test(warning)),
      shifts: day.shifts.map((shift) => ({
        ...shift,
        privateCost: 0,
      })),
    };
  });

  const labourBudget = days.reduce((sum, day) => sum + day.labourBudget, 0);
  const plannedCost = days.reduce((sum, day) => sum + day.plannedCost, 0);

  return {
    ...plan,
    labourTargetPct: plan.forecastSales > 0 ? labourBudget / plan.forecastSales * 100 : 0,
    labourBudget,
    plannedCost,
    explanation:
      "Forecast, cover and hours are unchanged. Cost figures in this kitchen-manager view include the hourly team only; salaried pay and salary allocation stay private.",
    warnings: plan.warnings.filter((warning) => !privateCostWarning.test(warning)),
    days,
  };
}

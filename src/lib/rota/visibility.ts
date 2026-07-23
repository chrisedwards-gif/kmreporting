import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { RotaStaffProfile } from "@/lib/rota/types";
import { visibleRotaWarnings } from "@/lib/rota/warnings";

export type RotaFinanceVisibility = "full" | "hourly_only";

export type RotaDisplayStaff = {
  id: string;
  appProfileId: string | null;
  name: string;
  role: string;
  roleRank: number;
  displayOrder: number;
  organisationWide: boolean;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
  payBasis: "hourly" | "salaried";
  hourlyRate: number | null;
};

export function visibleRotaStaff(staff: RotaStaffProfile[]): RotaDisplayStaff[] {
  return staff
    .map((person) => ({
      id: person.id,
      appProfileId: person.appProfileId,
      name: person.staffName,
      role: person.roleTitle || person.primaryRole || "Team",
      roleRank: person.roleRank,
      displayOrder: person.displayOrder,
      organisationWide: person.organisationWide,
      minimumHours: person.minimumWeeklyHours,
      targetHours: person.targetWeeklyHours,
      maximumHours: person.maximumWeeklyHours,
      payBasis: person.payBasis,
      hourlyRate: person.payBasis === "hourly" ? person.loadedHourlyRate : null,
    }))
    .sort((a, b) => a.roleRank - b.roleRank || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

export function visibleRotaPlan(
  plan: StoredRotaPlan,
  visibility: RotaFinanceVisibility,
): StoredRotaPlan {
  const audience = visibility === "full" ? "management" : "all";

  if (visibility === "full") {
    return {
      ...plan,
      warnings: visibleRotaWarnings(plan.warnings, audience),
      days: plan.days.map((day) => ({
        ...day,
        warnings: visibleRotaWarnings(day.warnings, audience),
      })),
    };
  }

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
      warnings: visibleRotaWarnings(day.warnings, audience),
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
    warnings: visibleRotaWarnings(plan.warnings, audience),
    days,
  };
}

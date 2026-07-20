import type { CostSnapshot, ReviewFlag } from "@/lib/types";

type ReviewTargets = {
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
};

type NarrativeChecks = {
  complianceIssues?: string;
  supportNeeded?: string;
};

export function buildReviewFlags(
  costs: CostSnapshot,
  targets: ReviewTargets,
  narrative: NarrativeChecks = {},
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (costs.foodCostPct > targets.foodCostTarget) {
    flags.push({
      code: "FOOD_COST_OVER_TARGET",
      label: costs.foodCostBasis === "stock_adjusted" ? "Food cost over target" : "Food spend over target",
      detail: `${costs.foodCostPct.toFixed(1)}% vs ${targets.foodCostTarget.toFixed(1)}% target`,
      severity: costs.foodCostPct > targets.foodCostTarget + 3 ? "critical" : "warning",
    });
  }

  if (costs.labourPct > targets.labourTarget) {
    flags.push({
      code: "LABOUR_OVER_TARGET",
      label: "Labour over target",
      detail: `${costs.labourPct.toFixed(1)}% vs ${targets.labourTarget.toFixed(1)}% target`,
      severity: costs.labourPct > targets.labourTarget + 3 ? "critical" : "warning",
    });
  }

  if (costs.wastePct > targets.wasteTarget) {
    flags.push({
      code: "WASTE_OVER_TARGET",
      label: "Waste over target",
      detail: `${costs.wastePct.toFixed(1)}% vs ${targets.wasteTarget.toFixed(1)}% target`,
      severity: "warning",
    });
  }

  if (narrative.complianceIssues?.trim()) {
    flags.push({
      code: "COMPLIANCE_REVIEW",
      label: "Compliance issue reported",
      detail: "A manager must review the compliance notes before approval.",
      severity: "critical",
    });
  }

  if (narrative.supportNeeded?.trim()) {
    flags.push({
      code: "SUPPORT_REQUESTED",
      label: "Support requested",
      detail: "The kitchen has requested group-level support.",
      severity: "info",
    });
  }

  return flags;
}

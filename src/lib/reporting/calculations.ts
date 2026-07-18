import type { CostInputs, CostSnapshot } from "@/lib/types";

const safePercentage = (value: number, total: number) =>
  total > 0 ? (value / total) * 100 : 0;

export function calculateCosts(input: CostInputs): CostSnapshot {
  const netPurchases = input.purchases - input.credits;
  const stocktakeCompleted = input.stocktakeCompleted ?? true;
  const cogs = stocktakeCompleted
    ? input.openingStock + netPurchases + input.transfersIn - input.transfersOut - input.closingStock + input.adjustments
    : netPurchases + input.transfersIn - input.transfersOut + input.adjustments;
  const calculatedStaffCost = input.paidHours * input.averageLoadedRate + input.agencyCost + input.overtimePremium;
  const staffCost = input.staffCostOverride ?? calculatedStaffCost;
  const primeCost = cogs + staffCost;

  return {
    cogs,
    foodCostPct: safePercentage(cogs, input.netSales),
    staffCost,
    labourPct: safePercentage(staffCost, input.netSales),
    wastePct: safePercentage(input.wasteCost, input.netSales),
    primeCost,
    primeCostPct: safePercentage(primeCost, input.netSales),
    foodCostBasis: stocktakeCompleted ? "stock_adjusted" : "spend",
  };
}

export const sumSnapshots = (snapshots: CostSnapshot[]): CostSnapshot =>
  snapshots.reduce(
    (total, snapshot) => ({
      cogs: total.cogs + snapshot.cogs,
      foodCostPct: 0,
      staffCost: total.staffCost + snapshot.staffCost,
      labourPct: 0,
      wastePct: 0,
      primeCost: total.primeCost + snapshot.primeCost,
      primeCostPct: 0,
      foodCostBasis: snapshots.every((item) => item.foodCostBasis === "stock_adjusted") ? "stock_adjusted" : "spend",
    }),
    {
      cogs: 0,
      foodCostPct: 0,
      staffCost: 0,
      labourPct: 0,
      wastePct: 0,
      primeCost: 0,
      primeCostPct: 0,
      foodCostBasis: "stock_adjusted",
    },
  );

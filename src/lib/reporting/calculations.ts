import type { CostInputs, CostSnapshot } from "@/lib/types";

const safePercentage = (value: number, total: number) =>
  total > 0 ? (value / total) * 100 : 0;

export function calculateCosts(input: CostInputs): CostSnapshot {
  const netPurchases = input.purchases - input.credits;
  const cogs =
    input.openingStock +
    netPurchases +
    input.transfersIn -
    input.transfersOut -
    input.closingStock +
    input.adjustments;
  const staffCost =
    input.paidHours * input.averageLoadedRate +
    input.agencyCost +
    input.overtimePremium;
  const primeCost = cogs + staffCost;

  return {
    cogs,
    foodCostPct: safePercentage(cogs, input.netSales),
    staffCost,
    labourPct: safePercentage(staffCost, input.netSales),
    wastePct: safePercentage(input.wasteCost, input.netSales),
    primeCost,
    primeCostPct: safePercentage(primeCost, input.netSales),
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
    }),
    {
      cogs: 0,
      foodCostPct: 0,
      staffCost: 0,
      labourPct: 0,
      wastePct: 0,
      primeCost: 0,
      primeCostPct: 0,
    },
  );

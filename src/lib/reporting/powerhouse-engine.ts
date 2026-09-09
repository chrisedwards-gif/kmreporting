import type { DecisionSignal, HourlySalesMetric, ProductMetric } from "@/lib/reporting/decision-engine";

export type MenuCostMetric = {
  siteId: string;
  itemName: string;
  unitFoodCost: number;
  validFrom: string;
};

export type SiteDecisionTarget = {
  siteId: string;
  siteName: string;
  foodCostTarget: number;
};

export type HourlyLabourMetric = {
  siteId: string;
  siteName: string;
  businessDate: string;
  slotTime: string;
  staffedHours: number;
  staffCount: number;
  hourlyCost: number;
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(value);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const dayName = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const confidence = (sample: number, base = 55) => Math.min(95, Math.round(base + sample * 5));

export function buildPowerhouseSignals({
  products,
  menuCosts,
  siteTargets,
  hourlySales,
  hourlyLabour,
}: {
  products: ProductMetric[];
  menuCosts: MenuCostMetric[];
  siteTargets: SiteDecisionTarget[];
  hourlySales: HourlySalesMetric[];
  hourlyLabour: HourlyLabourMetric[];
}): DecisionSignal[] {
  const siteIds = [...new Set([...products.map((row) => row.siteId), ...hourlySales.map((row) => row.siteId), ...hourlyLabour.map((row) => row.siteId)])];
  const output: DecisionSignal[] = [];
  for (const siteId of siteIds) {
    const target = siteTargets.find((row) => row.siteId === siteId);
    const siteName = target?.siteName ?? products.find((row) => row.siteId === siteId)?.siteName ?? hourlySales.find((row) => row.siteId === siteId)?.siteName ?? "Kitchen";
    output.push(...menuEngineeringSignals({
      siteId,
      siteName,
      foodCostTarget: target?.foodCostTarget || 30,
      products: products.filter((row) => row.siteId === siteId),
      menuCosts: menuCosts.filter((row) => row.siteId === siteId),
    }));
    output.push(...hourlyStaffingSignals({
      siteId,
      siteName,
      salesRows: hourlySales.filter((row) => row.siteId === siteId),
      labourRows: hourlyLabour.filter((row) => row.siteId === siteId),
    }));
  }
  return output;
}

function menuEngineeringSignals({ siteId, siteName, foodCostTarget, products, menuCosts }: {
  siteId: string;
  siteName: string;
  foodCostTarget: number;
  products: ProductMetric[];
  menuCosts: MenuCostMetric[];
}): DecisionSignal[] {
  if (!products.length || !menuCosts.length) return [];
  const costByKey = new Map<string, MenuCostMetric>();
  for (const cost of [...menuCosts].sort((a, b) => a.validFrom.localeCompare(b.validFrom))) costByKey.set(normalise(cost.itemName), cost);
  const weeks = [...new Set(products.map((row) => row.weekStart))].sort().slice(-8);
  if (weeks.length < 4) return [];
  const recent = products.filter((row) => weeks.includes(row.weekStart));
  const byItem = new Map<string, ProductMetric[]>();
  for (const row of recent) {
    const key = normalise(row.itemName);
    const values = byItem.get(key) ?? [];
    values.push(row);
    byItem.set(key, values);
  }
  const totalSales = recent.reduce((sum, row) => sum + Math.max(row.netSales, 0), 0);
  const candidates = [...byItem.entries()].flatMap(([key, rows]) => {
    const cost = costByKey.get(key);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const sales = rows.reduce((sum, row) => sum + row.netSales, 0);
    if (!cost || quantity <= 0 || sales <= 0) return [];
    const realisedPrice = sales / quantity;
    const margin = realisedPrice - cost.unitFoodCost;
    const grossMarginPct = realisedPrice > 0 ? margin / realisedPrice * 100 : 0;
    const foodCostPct = realisedPrice > 0 ? cost.unitFoodCost / realisedPrice * 100 : 0;
    const averageWeeklyQty = quantity / weeks.length;
    const sharePct = totalSales > 0 ? sales / totalSales * 100 : 0;
    const weeksPresent = new Set(rows.filter((row) => row.quantity > 0).map((row) => row.weekStart)).size;
    return [{ key, rows, itemName: rows[0]?.itemName ?? cost.itemName, category: rows[0]?.category ?? "Uncategorised", quantity, sales, realisedPrice, margin, grossMarginPct, foodCostPct, averageWeeklyQty, sharePct, weeksPresent, unitFoodCost: cost.unitFoodCost }];
  });
  if (!candidates.length) return [];
  const medianVolume = median(candidates.map((row) => row.averageWeeklyQty).filter((value) => value > 0));
  const highVolume = Math.max(8, medianVolume * 1.15);
  const lowVolume = Math.max(4, medianVolume * 0.55);
  const targetMargin = 100 - foodCostTarget;
  const signals: DecisionSignal[] = [];

  for (const item of candidates) {
    const highMargin = item.grossMarginPct >= targetMargin - 2;
    const weakMargin = item.grossMarginPct < targetMargin - 6;
    const strongVolume = item.averageWeeklyQty >= highVolume;
    const weakVolume = item.averageWeeklyQty <= lowVolume && item.sharePct < 1.2;

    if (strongVolume && weakMargin) {
      const targetPrice = foodCostTarget > 0 ? item.unitFoodCost / (foodCostTarget / 100) : item.realisedPrice;
      const priceGap = Math.max(targetPrice - item.realisedPrice, 0);
      const testIncrease = Math.min(Math.max(Math.ceil(priceGap * 2) / 2, 0.5), 1.5);
      const upside = item.averageWeeklyQty * testIncrease;
      signals.push({
        key: `menu-workhorse-${item.key}`,
        siteId,
        siteName,
        category: "pricing",
        severity: "opportunity",
        title: `High-volume but weak-margin: ${item.itemName}`,
        finding: `${item.itemName} averages ${item.averageWeeklyQty.toFixed(1)} units/week but is running at about ${item.foodCostPct.toFixed(1)}% food cost versus a ${foodCostTarget.toFixed(1)}% site target.`,
        recommendation: `Treat this as a workhorse. Test a £${testIncrease.toFixed(2)} price increase, portion/spec saving or both. Measure unit volume and contribution for two weeks before making the change permanent.`,
        confidence: confidence(item.weeksPresent, 60),
        estimatedWeeklyImpact: round(upside),
        impactDirection: "margin",
        evidence: [`${item.weeksPresent}/${weeks.length} weeks sold`, `${item.averageWeeklyQty.toFixed(1)} units/week`, `Realised value ${gbp(item.realisedPrice)}`, `Unit food cost ${gbp(item.unitFoodCost)}`, `Food cost ${item.foodCostPct.toFixed(1)}%`, `Target ${foodCostTarget.toFixed(1)}%`],
      });
    } else if (weakVolume && weakMargin && item.weeksPresent >= 4) {
      signals.push({
        key: `menu-dog-${item.key}`,
        siteId,
        siteName,
        category: "menu",
        severity: "risk",
        title: `Strong removal/rework candidate: ${item.itemName}`,
        finding: `${item.itemName} is both low-volume (${item.averageWeeklyQty.toFixed(1)} units/week) and weak-margin (${item.foodCostPct.toFixed(1)}% food cost) across ${item.weeksPresent} observed weeks.`,
        recommendation: "Review removal, replacement or a major recipe/price reset. Before removing it, check whether it has a strategic dietary, sharing or traffic-driving role and whether sales transfer to a better-margin substitute.",
        confidence: confidence(item.weeksPresent, 64),
        estimatedWeeklyImpact: null,
        impactDirection: "margin",
        evidence: [`${item.averageWeeklyQty.toFixed(1)} units/week`, `${item.sharePct.toFixed(2)}% of product sales`, `Food cost ${item.foodCostPct.toFixed(1)}%`, `Contribution about ${gbp(item.margin)} per unit`],
      });
    } else if (weakVolume && highMargin && item.weeksPresent >= 4) {
      signals.push({
        key: `menu-puzzle-${item.key}`,
        siteId,
        siteName,
        category: "menu",
        severity: "opportunity",
        title: `High-margin but under-selling: ${item.itemName}`,
        finding: `${item.itemName} earns about ${gbp(item.margin)} contribution per unit at ${item.grossMarginPct.toFixed(1)}% gross margin, but averages only ${item.averageWeeklyQty.toFixed(1)} units/week.`,
        recommendation: "Do not remove this on popularity alone. Test menu position, description, imagery, staff recommendation or inclusion in a deal before considering removal.",
        confidence: confidence(item.weeksPresent, 58),
        estimatedWeeklyImpact: round(item.margin * Math.max(2, item.averageWeeklyQty * 0.2)),
        impactDirection: "margin",
        evidence: [`Unit contribution ${gbp(item.margin)}`, `Gross margin ${item.grossMarginPct.toFixed(1)}%`, `${item.averageWeeklyQty.toFixed(1)} units/week`, `${item.weeksPresent} observed weeks`],
      });
    } else if (strongVolume && highMargin) {
      signals.push({
        key: `menu-star-${item.key}`,
        siteId,
        siteName,
        category: "menu",
        severity: "info",
        title: `Protect the star: ${item.itemName}`,
        finding: `${item.itemName} combines strong volume (${item.averageWeeklyQty.toFixed(1)} units/week) with ${item.grossMarginPct.toFixed(1)}% gross margin.`,
        recommendation: "Protect availability, prep consistency and menu visibility. Use this item as a benchmark before changing neighbouring dishes.",
        confidence: confidence(item.weeksPresent, 62),
        estimatedWeeklyImpact: null,
        impactDirection: "margin",
        evidence: [`${item.averageWeeklyQty.toFixed(1)} units/week`, `Contribution ${gbp(item.margin)}/unit`, `Food cost ${item.foodCostPct.toFixed(1)}%`],
      });
    }
  }
  return signals.slice(0, 12);
}

function hourlyStaffingSignals({ siteId, siteName, salesRows, labourRows }: {
  siteId: string;
  siteName: string;
  salesRows: HourlySalesMetric[];
  labourRows: HourlyLabourMetric[];
}): DecisionSignal[] {
  if (!salesRows.length || !labourRows.length) return [];
  const labourBySlot = new Map<string, HourlyLabourMetric>();
  for (const row of labourRows) labourBySlot.set(`${row.businessDate}:${row.slotTime.slice(0, 5)}`, row);
  const joined = salesRows.flatMap((sale) => {
    const labour = labourBySlot.get(`${sale.businessDate}:${sale.slotTime.slice(0, 5)}`);
    if (!labour || labour.staffedHours <= 0 || sale.netSales <= 0) return [];
    return [{ sale, labour, splh: sale.netSales / labour.staffedHours, salesPerStaff: labour.staffCount > 0 ? sale.netSales / labour.staffCount : 0 }];
  });
  if (joined.length < 20) return [];
  const groups = new Map<string, typeof joined>();
  for (const row of joined) {
    const key = `${weekday(row.sale.businessDate)}:${row.sale.slotTime.slice(0, 5)}`;
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }
  const slots = [...groups.entries()].flatMap(([key, values]) => {
    const dates = new Set(values.map((row) => row.sale.businessDate));
    if (dates.size < 3) return [];
    const [day, slot] = key.split(":", 2);
    return [{
      day: Number(day), slot, sample: dates.size,
      sales: mean(values.map((row) => row.sale.netSales)),
      staffedHours: mean(values.map((row) => row.labour.staffedHours)),
      staffCount: mean(values.map((row) => row.labour.staffCount)),
      cost: mean(values.map((row) => row.labour.hourlyCost)),
      splh: mean(values.map((row) => row.splh)),
      exampleDate: values[0].sale.businessDate,
    }];
  });
  if (slots.length < 4) return [];
  const splhMedian = median(slots.map((row) => row.splh).filter((value) => value > 0));
  const salesMedian = median(slots.map((row) => row.sales).filter((value) => value > 0));
  const signals: DecisionSignal[] = [];

  for (const slot of slots.filter((row) => row.sales >= salesMedian * 1.25 && row.splh >= splhMedian * 1.3).sort((a, b) => b.splh - a.splh).slice(0, 2)) {
    signals.push({
      key: `hourly-service-pressure-${slot.day}-${slot.slot}`,
      siteId,
      siteName,
      category: "labour",
      severity: "risk",
      title: `Service pressure: ${dayName(slot.exampleDate)} ${slot.slot}`,
      finding: `${siteName} averages ${gbp(slot.sales)} sales with ${slot.staffCount.toFixed(1)} people / ${slot.staffedHours.toFixed(1)} staffed hours in this slot, producing ${gbp(slot.splh)} sales per staffed hour.`,
      recommendation: "Test moving or adding coverage into this hour from a quieter shoulder before adding net weekly hours. Check ticket times/service feedback during the test.",
      confidence: confidence(slot.sample, 62),
      estimatedWeeklyImpact: null,
      impactDirection: "service",
      evidence: [`${slot.sample} comparable ${dayName(slot.exampleDate)}s`, `${gbp(slot.sales)} average sales`, `${slot.staffCount.toFixed(1)} average staff`, `${gbp(slot.splh)} sales/staffed hour`, `Site slot median ${gbp(splhMedian)}`],
    });
  }

  for (const slot of slots.filter((row) => row.sales <= salesMedian * 0.65 && row.splh <= splhMedian * 0.65 && row.staffCount >= 1.5).sort((a, b) => a.splh - b.splh).slice(0, 2)) {
    const testSaving = slot.cost > 0 ? Math.min(slot.cost / Math.max(slot.staffCount, 1), slot.cost * 0.5) : 0;
    signals.push({
      key: `hourly-labour-opportunity-${slot.day}-${slot.slot}`,
      siteId,
      siteName,
      category: "labour",
      severity: "opportunity",
      title: `Labour test window: ${dayName(slot.exampleDate)} ${slot.slot}`,
      finding: `${siteName} averages only ${gbp(slot.sales)} sales in this slot with ${slot.staffCount.toFixed(1)} staff and ${gbp(slot.splh)} sales per staffed hour.`,
      recommendation: "Trial moving one person’s start, break or prep hour away from this slot rather than deleting a whole shift. Compare service impact and sales/labour hour for two comparable weeks.",
      confidence: confidence(slot.sample, 60),
      estimatedWeeklyImpact: testSaving > 0 ? round(testSaving) : null,
      impactDirection: "saving",
      evidence: [`${slot.sample} comparable ${dayName(slot.exampleDate)}s`, `${gbp(slot.sales)} average sales`, `${slot.staffCount.toFixed(1)} average staff`, `${gbp(slot.splh)} sales/staffed hour`, `Site slot median ${gbp(splhMedian)}`],
    });
  }
  return signals;
}

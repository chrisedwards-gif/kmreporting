export type DecisionSeverity = "opportunity" | "watch" | "risk" | "info";
export type DecisionCategory = "sales" | "menu" | "pricing" | "labour" | "food_cost" | "waste" | "procurement" | "reconciliation" | "data_quality";

export type DecisionSignal = {
  key: string;
  siteId: string;
  siteName: string;
  category: DecisionCategory;
  severity: DecisionSeverity;
  title: string;
  finding: string;
  recommendation: string;
  confidence: number;
  estimatedWeeklyImpact: number | null;
  impactDirection: "revenue" | "saving" | "margin" | "service" | "none";
  evidence: string[];
};

export type WeeklyMetric = {
  siteId: string;
  siteName: string;
  weekStart: string;
  netSales: number;
  foodCostPct: number | null;
  labourPct: number | null;
  wastePct: number | null;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
};

export type ProductMetric = {
  siteId: string;
  siteName: string;
  weekStart: string;
  itemName: string;
  category: string;
  quantity: number;
  netSales: number;
};

export type HourlySalesMetric = {
  siteId: string;
  siteName: string;
  businessDate: string;
  slotTime: string;
  netSales: number;
  transactions: number;
  covers: number;
};

export type DailyLabourMetric = {
  siteId: string;
  siteName: string;
  businessDate: string;
  actualHours: number;
  actualHourlyCost: number;
  salaryCostAllocated: number;
};

export type ReconciliationMetric = {
  siteId: string;
  siteName: string;
  metricKey: string;
  siteValue: number | null;
  masterValue: number | null;
  variance: number | null;
  variancePct: number | null;
  status: "match" | "warning" | "missing_site" | "missing_master";
};

export type DecisionEngineInput = {
  weeks: WeeklyMetric[];
  products: ProductMetric[];
  hourlySales: HourlySalesMetric[];
  dailyLabour: DailyLabourMetric[];
  reconciliations?: ReconciliationMetric[];
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
const pct = (current: number, reference: number) => reference > 0 ? ((current - reference) / reference) * 100 : 0;
const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const dayName = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const hourLabel = (slot: string) => slot.slice(0, 5);
const clampConfidence = (value: number) => Math.max(0, Math.min(95, Math.round(value)));

export function buildDecisionSignals(input: DecisionEngineInput): DecisionSignal[] {
  const siteIds = [...new Set([
    ...input.weeks.map((row) => row.siteId),
    ...input.products.map((row) => row.siteId),
    ...input.hourlySales.map((row) => row.siteId),
    ...input.dailyLabour.map((row) => row.siteId),
  ])];
  const signals: DecisionSignal[] = [];

  for (const siteId of siteIds) {
    const weeks = input.weeks.filter((row) => row.siteId === siteId).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const products = input.products.filter((row) => row.siteId === siteId);
    const hourlySales = input.hourlySales.filter((row) => row.siteId === siteId);
    const dailyLabour = input.dailyLabour.filter((row) => row.siteId === siteId);
    const reconciliations = (input.reconciliations ?? []).filter((row) => row.siteId === siteId);
    const siteName = weeks.at(-1)?.siteName ?? products[0]?.siteName ?? hourlySales[0]?.siteName ?? dailyLabour[0]?.siteName ?? "Kitchen";

    signals.push(...weeklyTrendSignals(siteId, siteName, weeks));
    signals.push(...productSignals(siteId, siteName, products));
    signals.push(...hourlyDemandSignals(siteId, siteName, hourlySales));
    signals.push(...labourEfficiencySignals(siteId, siteName, hourlySales, dailyLabour));
    signals.push(...reconciliationSignals(siteId, siteName, reconciliations));
  }

  return signals
    .sort((a, b) => scoreSignal(b) - scoreSignal(a))
    .slice(0, 30);
}

function weeklyTrendSignals(siteId: string, siteName: string, rows: WeeklyMetric[]): DecisionSignal[] {
  if (!rows.length) return [];
  const current = rows.at(-1)!;
  const prior = rows.slice(-5, -1).filter((row) => row.netSales > 0);
  const signals: DecisionSignal[] = [];

  if (prior.length >= 3 && current.netSales > 0) {
    const baseline = mean(prior.map((row) => row.netSales));
    const change = pct(current.netSales, baseline);
    if (Math.abs(change) >= 8) {
      const positive = change > 0;
      signals.push({
        key: `sales-momentum-${current.weekStart}`,
        siteId,
        siteName,
        category: "sales",
        severity: positive ? "opportunity" : "risk",
        title: positive ? "Sales are materially ahead of the recent run-rate" : "Sales have dropped below the recent run-rate",
        finding: `${siteName} delivered ${gbp(current.netSales)}, ${Math.abs(change).toFixed(1)}% ${positive ? "above" : "below"} the previous ${prior.length}-week average of ${gbp(baseline)}.`,
        recommendation: positive
          ? "Identify whether traffic, ATV or a specific product/daypart drove the lift and protect that behaviour next week."
          : "Split the decline into traffic, ATV, daypart and product mix before changing labour or menu pricing.",
        confidence: clampConfidence(66 + prior.length * 5),
        estimatedWeeklyImpact: round(Math.abs(current.netSales - baseline)),
        impactDirection: positive ? "revenue" : "none",
        evidence: [`Current week ${gbp(current.netSales)}`, `${prior.length}-week baseline ${gbp(baseline)}`, `${change.toFixed(1)}% variance`],
      });
    }
  }

  if (current.netSales > 0 && current.labourPct != null && current.labourTarget > 0) {
    const gap = current.labourPct - current.labourTarget;
    if (gap >= 1.5) {
      const opportunity = current.netSales * (gap / 100);
      signals.push({
        key: `labour-target-${current.weekStart}`,
        siteId,
        siteName,
        category: "labour",
        severity: gap >= 3 ? "risk" : "watch",
        title: `Labour is ${gap.toFixed(1)}pp above target`,
        finding: `${siteName} is at ${current.labourPct.toFixed(1)}% labour against a ${current.labourTarget.toFixed(1)}% target.`,
        recommendation: "Use the hourly demand view to find where paid hours are sitting outside demand. Do not cut peak coverage simply to hit the percentage.",
        confidence: 90,
        estimatedWeeklyImpact: round(opportunity),
        impactDirection: "saving",
        evidence: [`Labour ${current.labourPct.toFixed(1)}%`, `Target ${current.labourTarget.toFixed(1)}%`, `Gap ${gap.toFixed(1)}pp`, `Equivalent to ${gbp(opportunity)} at current sales`],
      });
    }
  }

  if (current.netSales > 0 && current.foodCostPct != null && current.foodCostTarget > 0) {
    const gap = current.foodCostPct - current.foodCostTarget;
    if (gap >= 1.25) {
      const opportunity = current.netSales * (gap / 100);
      signals.push({
        key: `food-cost-target-${current.weekStart}`,
        siteId,
        siteName,
        category: "food_cost",
        severity: gap >= 3 ? "risk" : "watch",
        title: `Food cost/spend is ${gap.toFixed(1)}pp above target`,
        finding: `${siteName} is at ${current.foodCostPct.toFixed(1)}% against a ${current.foodCostTarget.toFixed(1)}% target.`,
        recommendation: "Check purchase timing, credits, waste and product mix before changing recipe specs. If the variance persists after reconciliation, drill into high-cost ingredients and low-margin dishes.",
        confidence: 88,
        estimatedWeeklyImpact: round(opportunity),
        impactDirection: "margin",
        evidence: [`Food ${current.foodCostPct.toFixed(1)}%`, `Target ${current.foodCostTarget.toFixed(1)}%`, `Gap ${gap.toFixed(1)}pp`, `Equivalent to ${gbp(opportunity)} at current sales`],
      });
    }
  }

  if (current.netSales > 0 && current.wastePct != null && current.wasteTarget > 0) {
    const gap = current.wastePct - current.wasteTarget;
    if (gap >= 0.35) {
      const opportunity = current.netSales * (gap / 100);
      signals.push({
        key: `waste-target-${current.weekStart}`,
        siteId,
        siteName,
        category: "waste",
        severity: gap >= 1 ? "risk" : "watch",
        title: "Waste is above the kitchen target",
        finding: `${siteName} is at ${current.wastePct.toFixed(1)}% waste against ${current.wasteTarget.toFixed(1)}%.`,
        recommendation: "Separate prep, spoilage and service waste. Target the largest repeated cause rather than applying a blanket purchasing cut.",
        confidence: 88,
        estimatedWeeklyImpact: round(opportunity),
        impactDirection: "saving",
        evidence: [`Waste ${current.wastePct.toFixed(1)}%`, `Target ${current.wasteTarget.toFixed(1)}%`, `Excess value about ${gbp(opportunity)}`],
      });
    }
  }

  return signals;
}

function productSignals(siteId: string, siteName: string, rows: ProductMetric[]): DecisionSignal[] {
  const weekStarts = [...new Set(rows.map((row) => row.weekStart))].sort().slice(-8);
  if (weekStarts.length < 4) return [];
  const recentRows = rows.filter((row) => weekStarts.includes(row.weekStart));
  const productWeeks = new Map<string, ProductMetric[]>();
  for (const row of recentRows) {
    const key = normalise(row.itemName);
    const current = productWeeks.get(key) ?? [];
    current.push(row);
    productWeeks.set(key, current);
  }
  const totalSales = recentRows.reduce((sum, row) => sum + Math.max(row.netSales, 0), 0);
  const weeklyCount = weekStarts.length;
  const signals: DecisionSignal[] = [];

  const candidates = [...productWeeks.entries()].map(([key, productRows]) => {
    const sample = productRows.filter((row) => row.quantity > 0 || row.netSales > 0);
    const sales = sample.reduce((sum, row) => sum + row.netSales, 0);
    const qty = sample.reduce((sum, row) => sum + row.quantity, 0);
    const weeksPresent = new Set(sample.map((row) => row.weekStart)).size;
    const averageWeeklyQty = qty / weeklyCount;
    const sharePct = totalSales > 0 ? sales / totalSales * 100 : 0;
    const unitPrices = sample.filter((row) => row.quantity > 0).map((row) => row.netSales / row.quantity).filter((value) => value > 0);
    return { key, sample, sales, qty, weeksPresent, averageWeeklyQty, sharePct, unitPrice: mean(unitPrices), itemName: sample[0]?.itemName ?? key, category: sample[0]?.category ?? "Uncategorised" };
  });

  for (const item of candidates
    .filter((candidate) => candidate.weeksPresent >= Math.min(4, weeklyCount) && candidate.sharePct < 0.8 && candidate.averageWeeklyQty < 6)
    .sort((a, b) => a.sharePct - b.sharePct || a.averageWeeklyQty - b.averageWeeklyQty)
    .slice(0, 3)) {
    signals.push({
      key: `menu-review-${item.key}`,
      siteId,
      siteName,
      category: "menu",
      severity: "watch",
      title: `Menu review: ${item.itemName}`,
      finding: `${item.itemName} has appeared in ${item.weeksPresent} of the last ${weeklyCount} reporting weeks but averages only ${item.averageWeeklyQty.toFixed(1)} units a week and ${item.sharePct.toFixed(2)}% of recorded product sales.`,
      recommendation: "Review whether this dish earns its prep space, ingredients and menu attention. Do not remove it until margin, strategic role and substitutions are checked.",
      confidence: clampConfidence(55 + item.weeksPresent * 6),
      estimatedWeeklyImpact: null,
      impactDirection: "margin",
      evidence: [`${item.weeksPresent}/${weeklyCount} weeks present`, `${item.averageWeeklyQty.toFixed(1)} units/week`, `${item.sharePct.toFixed(2)}% sales mix`, `${gbp(item.sales)} sales over the observed period`],
    });
  }

  const categoryPrices = new Map<string, number[]>();
  for (const candidate of candidates) {
    if (candidate.unitPrice <= 0 || candidate.averageWeeklyQty <= 0) continue;
    const key = normalise(candidate.category);
    const prices = categoryPrices.get(key) ?? [];
    prices.push(candidate.unitPrice);
    categoryPrices.set(key, prices);
  }
  const volumeValues = candidates.filter((candidate) => candidate.averageWeeklyQty > 0).map((candidate) => candidate.averageWeeklyQty);
  const highVolumeCutoff = volumeValues.length ? [...volumeValues].sort((a, b) => a - b)[Math.floor(volumeValues.length * 0.7)] ?? 0 : 0;

  for (const item of candidates
    .filter((candidate) => candidate.weeksPresent >= 4 && candidate.averageWeeklyQty >= Math.max(highVolumeCutoff, 8) && candidate.unitPrice > 0)
    .slice(0, 20)) {
    const peerMedian = median(categoryPrices.get(normalise(item.category)) ?? []);
    if (peerMedian <= 0 || item.unitPrice >= peerMedian * 0.92) continue;
    const testRise = 0.5;
    const weeklyUpside = item.averageWeeklyQty * testRise;
    signals.push({
      key: `pricing-test-${item.key}`,
      siteId,
      siteName,
      category: "pricing",
      severity: "opportunity",
      title: `Pricing test candidate: ${item.itemName}`,
      finding: `${item.itemName} averages ${item.averageWeeklyQty.toFixed(1)} units a week at about £${item.unitPrice.toFixed(2)} net per unit, below the ${item.category} median of £${peerMedian.toFixed(2)} in the captured mix.`,
      recommendation: `Test a £${testRise.toFixed(2)} increase rather than making a permanent jump. Track unit volume, revenue and guest feedback for two weeks; roll back if volume loss wipes out the gain.`,
      confidence: clampConfidence(52 + item.weeksPresent * 4),
      estimatedWeeklyImpact: round(weeklyUpside),
      impactDirection: "revenue",
      evidence: [`${item.averageWeeklyQty.toFixed(1)} units/week`, `Current realised unit value £${item.unitPrice.toFixed(2)}`, `Category median £${peerMedian.toFixed(2)}`, `No-margin assumption: +£${testRise.toFixed(2)} ≈ ${gbp(weeklyUpside)}/week before volume response`],
    });
  }

  return signals;
}

function hourlyDemandSignals(siteId: string, siteName: string, rows: HourlySalesMetric[]): DecisionSignal[] {
  if (rows.length < 20) return [];
  const groups = new Map<string, { weekday: number; slotTime: string; values: number[]; dates: Set<string> }>();
  for (const row of rows) {
    if (row.netSales <= 0) continue;
    const key = `${weekday(row.businessDate)}:${row.slotTime.slice(0, 5)}`;
    const current = groups.get(key) ?? { weekday: weekday(row.businessDate), slotTime: row.slotTime, values: [], dates: new Set<string>() };
    current.values.push(row.netSales);
    current.dates.add(row.businessDate);
    groups.set(key, current);
  }
  const slots = [...groups.values()]
    .filter((group) => group.dates.size >= 3)
    .map((group) => ({ ...group, average: mean(group.values), sample: group.dates.size }))
    .sort((a, b) => b.average - a.average);
  if (slots.length < 4) return [];
  const overall = mean(slots.map((slot) => slot.average));
  const strongest = slots[0];
  const weakest = [...slots].reverse().find((slot) => slot.average < overall * 0.55);
  const anchorDate = rows.find((row) => weekday(row.businessDate) === strongest.weekday)?.businessDate ?? rows[0].businessDate;
  const signals: DecisionSignal[] = [];

  if (strongest.average >= overall * 1.35) {
    signals.push({
      key: `peak-demand-${strongest.weekday}-${hourLabel(strongest.slotTime)}`,
      siteId,
      siteName,
      category: "labour",
      severity: "opportunity",
      title: `Protect coverage: ${dayName(anchorDate)} around ${hourLabel(strongest.slotTime)}`,
      finding: `This slot averages ${gbp(strongest.average)} sales across ${strongest.sample} observed ${dayName(anchorDate)}s, versus ${gbp(overall)} for a typical comparable slot.`,
      recommendation: "Treat this as a staffing anchor. Put your strongest service coverage here first, then flex hours around the quieter shoulders.",
      confidence: clampConfidence(58 + strongest.sample * 7),
      estimatedWeeklyImpact: null,
      impactDirection: "service",
      evidence: [`${strongest.sample} comparable dates`, `Average slot sales ${gbp(strongest.average)}`, `Typical slot ${gbp(overall)}`, `${(strongest.average / overall).toFixed(1)}× normal demand`],
    });
  }

  if (weakest) {
    const weakDate = rows.find((row) => weekday(row.businessDate) === weakest.weekday)?.businessDate ?? rows[0].businessDate;
    signals.push({
      key: `quiet-demand-${weakest.weekday}-${hourLabel(weakest.slotTime)}`,
      siteId,
      siteName,
      category: "labour",
      severity: "watch",
      title: `Quiet recurring slot: ${dayName(weakDate)} around ${hourLabel(weakest.slotTime)}`,
      finding: `Average sales are ${gbp(weakest.average)} across ${weakest.sample} comparable days, under 55% of a typical active slot.`,
      recommendation: "Review whether prep, breaks or handover hours can sit here. Do not remove service cover until hourly labour and service feedback confirm excess staffing.",
      confidence: clampConfidence(55 + weakest.sample * 6),
      estimatedWeeklyImpact: null,
      impactDirection: "saving",
      evidence: [`${weakest.sample} comparable dates`, `Average slot sales ${gbp(weakest.average)}`, `Typical slot ${gbp(overall)}`],
    });
  }

  return signals;
}

function labourEfficiencySignals(siteId: string, siteName: string, salesRows: HourlySalesMetric[], labourRows: DailyLabourMetric[]): DecisionSignal[] {
  if (!salesRows.length || !labourRows.length) return [];
  const salesByDate = new Map<string, number>();
  for (const row of salesRows) salesByDate.set(row.businessDate, (salesByDate.get(row.businessDate) ?? 0) + row.netSales);
  const samples = labourRows
    .filter((row) => row.actualHours > 0 && (salesByDate.get(row.businessDate) ?? 0) > 0)
    .map((row) => ({ businessDate: row.businessDate, sales: salesByDate.get(row.businessDate) ?? 0, hours: row.actualHours, splh: (salesByDate.get(row.businessDate) ?? 0) / row.actualHours }));
  if (samples.length < 6) return [];
  const overall = mean(samples.map((sample) => sample.splh));
  const byWeekday = new Map<number, typeof samples>();
  for (const sample of samples) {
    const key = weekday(sample.businessDate);
    const current = byWeekday.get(key) ?? [];
    current.push(sample);
    byWeekday.set(key, current);
  }
  const weekdayRows = [...byWeekday.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([day, values]) => ({ day, values, average: mean(values.map((value) => value.splh)) }))
    .sort((a, b) => a.average - b.average);
  const low = weekdayRows[0];
  if (!low || low.average >= overall * 0.78) return [];
  const exampleDate = low.values[0].businessDate;
  return [{
    key: `labour-efficiency-${low.day}`,
    siteId,
    siteName,
    category: "labour",
    severity: "watch",
    title: `${dayName(exampleDate)} labour efficiency is repeatedly weaker`,
    finding: `${dayName(exampleDate)} averages ${gbp(low.average)} sales per paid labour hour versus ${gbp(overall)} across the observed days.`,
    recommendation: "Check opening/prep overlap, early starts and close-down hours on this day. Use hourly labour coverage before making a specific shift cut.",
    confidence: clampConfidence(55 + low.values.length * 7),
    estimatedWeeklyImpact: null,
    impactDirection: "saving",
    evidence: [`${low.values.length} comparable ${dayName(exampleDate)}s`, `${gbp(low.average)} sales/labour hour`, `${gbp(overall)} overall sales/labour hour`],
  }];
}

function reconciliationSignals(siteId: string, siteName: string, rows: ReconciliationMetric[]): DecisionSignal[] {
  return rows
    .filter((row) => row.status !== "match")
    .map((row): DecisionSignal => ({
      key: `reconciliation-${row.metricKey}`,
      siteId,
      siteName,
      category: "reconciliation",
      severity: row.status.startsWith("missing") ? "risk" : "watch",
      title: `${row.metricKey.replaceAll("_", " ")} does not reconcile to the group source`,
      finding: row.status === "warning"
        ? `The site value ${row.siteValue ?? "—"} and master value ${row.masterValue ?? "—"} differ${row.variancePct != null ? ` by ${Math.abs(row.variancePct).toFixed(1)}%` : ""}.`
        : row.status === "missing_site" ? "The master pack has this metric but the kitchen submission does not." : "The kitchen submitted this metric but it is absent from the master pack.",
      recommendation: "Resolve the source mismatch before using this number for a commercial decision or approving the week.",
      confidence: 98,
      estimatedWeeklyImpact: row.variance != null ? Math.abs(row.variance) : null,
      impactDirection: "none",
      evidence: [`Site ${row.siteValue ?? "missing"}`, `Master ${row.masterValue ?? "missing"}`, row.variance != null ? `Variance ${row.variance}` : "Variance unavailable"],
    }));
}

function scoreSignal(signal: DecisionSignal) {
  const severity = signal.severity === "risk" ? 40 : signal.severity === "opportunity" ? 32 : signal.severity === "watch" ? 20 : 8;
  const financial = signal.estimatedWeeklyImpact ? Math.min(Math.log10(Math.max(signal.estimatedWeeklyImpact, 1)) * 7, 22) : 0;
  return severity + signal.confidence * 0.35 + financial;
}

import { buildSalesInsights, type SalesInsights } from "@/lib/reporting/sales-insights";
import type { ReportingWeek, WeeklyReport } from "@/lib/types";

export type Tone = "good" | "watch" | "bad";
export type ExpectedSite = { id: string; name: string; code: string };

export type ManagementPackInput = {
  week: ReportingWeek;
  expectedSites: ExpectedSite[];
  reports: WeeklyReport[];
  preparedFor?: string;
  salesInsightsByReport?: Record<string, SalesInsights>;
};

export type SiteView = {
  id: string;
  siteId: string;
  siteName: string;
  code: string;
  manager: string;
  status: WeeklyReport["status"];
  netSales: number;
  cogs: number;
  staffCost: number;
  hourlyStaffCost: number;
  salaryStaffCost: number;
  salaryOncostCost: number;
  salariesIncluded: boolean;
  wasteCost: number;
  foodCostPct: number;
  labourPct: number;
  wastePct: number;
  primeCostPct: number;
  foodTarget: number;
  labourTarget: number;
  wasteTarget: number;
  foodLabel: string;
  openControls: number;
  controls: string[];
  stocktakeCompleted: boolean;
  pendingCredits: number;
  awaitingInvoice: number;
  manualPurchases: number;
  manualPurchaseCount: number;
  wins: string;
  priorities: string;
  actions: string;
  support: string;
  salesInsights: SalesInsights;
};

const emptyNarrativePattern = /^(?:n\/?a|none|nil|no|not applicable|-+)$/i;
const emptySalesInsights = () => buildSalesInsights({ days: [], items: [], categories: [] });

export const cleanNarrative = (value: string | undefined, fallback = "") => {
  const trimmed = value?.trim() ?? "";
  return !trimmed || emptyNarrativePattern.test(trimmed) ? fallback : trimmed;
};

export const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${value}T00:00:00Z`));

export const formatCurrency = (value: number) => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  maximumFractionDigits: 2,
}).format(value);

export const formatCompactCurrency = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `£${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return formatCurrency(value);
};

export const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

export const variance = (actual: number, target: number) => {
  const difference = actual - target;
  if (Math.abs(difference) < 0.05) return { text: "On target", tone: "good" as Tone };
  const tone: Tone = difference <= 0 ? "good" : difference <= 2 ? "watch" : "bad";
  return {
    text: `${Math.abs(difference).toFixed(1)}pp ${difference < 0 ? "below" : "over"} target`,
    tone,
  };
};

const salaryBreakdown = (report: WeeklyReport) => {
  const flag = report.costs.flags.find((item) => item.code === "SALARY_COST_INCLUDED");
  const match = flag?.detail.match(/([\d,.]+)\s+salary\s+\+\s+([\d,.]+)\s+on-cost/i);
  const flagBase = match ? Number(match[1].replaceAll(",", "")) : 0;
  const flagOncost = match ? Number(match[2].replaceAll(",", "")) : 0;
  const base = report.costs.salaryStaffCost ?? flagBase;
  const oncost = report.costs.salaryOncostCost ?? flagOncost;
  const included = Boolean(report.costs.salariesIncluded || flag);
  return {
    base,
    oncost,
    included,
    hourly: report.costs.hourlyStaffCost ?? Math.max(report.costs.staffCost - base - oncost, 0),
  };
};

export const toSiteView = (report: WeeklyReport, salesInsights?: SalesInsights): SiteView => {
  const priorities = [
    ["Operational", report.operationalIssues],
    ["Staffing", report.staffingIssues],
    ["Compliance", report.complianceIssues],
    ["Equipment", report.equipmentIssues],
  ]
    .map(([label, text]) => {
      const narrative = cleanNarrative(text);
      return narrative ? `${label}: ${narrative}` : "";
    })
    .filter(Boolean)
    .join("  ");
  const manualPurchases = report.manualPurchases ?? [];
  const controls = report.costs.flags
    .filter((flag) => flag.severity !== "info")
    .map((flag) => `${flag.label}: ${flag.detail}`);
  const salary = salaryBreakdown(report);

  return {
    id: report.id,
    siteId: report.siteId,
    siteName: report.siteName,
    code: report.costs.code,
    manager: report.manager,
    status: report.status,
    netSales: report.costs.netSales,
    cogs: report.costs.cogs,
    staffCost: report.costs.staffCost,
    hourlyStaffCost: salary.hourly,
    salaryStaffCost: salary.base,
    salaryOncostCost: salary.oncost,
    salariesIncluded: salary.included,
    wasteCost: report.costs.wasteCost ?? report.costs.netSales * report.costs.wastePct / 100,
    foodCostPct: report.costs.foodCostPct,
    labourPct: report.costs.labourPct,
    wastePct: report.costs.wastePct,
    primeCostPct: report.costs.primeCostPct,
    foodTarget: report.costs.foodCostTarget,
    labourTarget: report.costs.labourTarget,
    wasteTarget: report.costs.wasteTarget,
    foodLabel: report.costs.foodCostBasis === "stock_adjusted" ? "Food cost" : "Food spend",
    openControls: controls.length,
    controls,
    stocktakeCompleted: Boolean(report.sources?.stocktakeCompleted),
    pendingCredits: report.sources?.pendingCredits ?? 0,
    awaitingInvoice: report.sources?.awaitingInvoice ?? 0,
    manualPurchases: manualPurchases.reduce((total, item) => total + item.amount, 0),
    manualPurchaseCount: manualPurchases.length,
    wins: cleanNarrative(report.wins, "No material win was recorded."),
    priorities: priorities || "No operational, staffing, compliance or equipment issue was reported.",
    actions: cleanNarrative(report.actionsUnderway, "No follow-up action was recorded. An owner and deadline should be agreed before the next weekly pack."),
    support: cleanNarrative(report.supportNeeded, "No group support was requested."),
    salesInsights: salesInsights ?? emptySalesInsights(),
  };
};

import type { ReportingWeek, WeeklyReport } from "@/lib/types";

export type Tone = "good" | "watch" | "bad";
export type ExpectedSite = { id: string; name: string; code: string };

export type ManagementPackInput = {
  week: ReportingWeek;
  expectedSites: ExpectedSite[];
  reports: WeeklyReport[];
  preparedFor?: string;
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
};

const emptyNarrativePattern = /^(?:n\/?a|none|nil|no|not applicable|-+)$/i;

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

export const toSiteView = (report: WeeklyReport): SiteView => {
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
    hourlyStaffCost: report.costs.hourlyStaffCost ?? report.costs.staffCost,
    salaryStaffCost: report.costs.salaryStaffCost ?? 0,
    salaryOncostCost: report.costs.salaryOncostCost ?? 0,
    salariesIncluded: Boolean(report.costs.salariesIncluded),
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
  };
};

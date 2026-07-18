export type AppRole = "admin" | "group_manager" | "finance" | "kitchen_manager" | "viewer";

export type ReportStatus =
  | "draft"
  | "submitted"
  | "review_required"
  | "approved"
  | "shared";

export type ReviewSeverity = "info" | "warning" | "critical";
export type FoodCostBasis = "spend" | "stock_adjusted";

export type ReviewFlag = {
  code: string;
  label: string;
  detail: string;
  severity: ReviewSeverity;
};

export type CostInputs = {
  netSales: number;
  openingStock: number;
  purchases: number;
  credits: number;
  transfersIn: number;
  transfersOut: number;
  closingStock: number;
  adjustments: number;
  paidHours: number;
  averageLoadedRate: number;
  agencyCost: number;
  overtimePremium: number;
  wasteCost: number;
  staffCostOverride?: number;
  stocktakeCompleted?: boolean;
};

export type CostSnapshot = {
  cogs: number;
  foodCostPct: number;
  staffCost: number;
  labourPct: number;
  wastePct: number;
  primeCost: number;
  primeCostPct: number;
  foodCostBasis: FoodCostBasis;
};

export type SitePerformance = CostSnapshot & {
  reportId?: string;
  id: string;
  code: string;
  name: string;
  manager: string;
  netSales: number;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
  status: ReportStatus;
  flags: ReviewFlag[];
};

export type ReportingWeek = {
  id?: string;
  start: string;
  end: string;
  dueAt: string;
};

export type WeeklyReport = {
  id: string;
  siteId: string;
  siteName: string;
  manager: string;
  weekStart: string;
  weekEnd: string;
  status: ReportStatus;
  updatedAt: string;
  submittedAt?: string;
  wins: string;
  operationalIssues: string;
  staffingIssues: string;
  complianceIssues: string;
  equipmentIssues: string;
  actionsUnderway: string;
  supportNeeded: string;
  costs: SitePerformance;
  sources?: {
    sales: string;
    purchasing: string;
    labour: string;
    salesReference?: string;
    purchasingReference?: string;
    labourReference?: string;
    pendingCredits: number;
    awaitingInvoice: number;
    stocktakeCompleted: boolean;
  };
};

export type ReportDraftInput = {
  reportId: string;
  siteId: string;
  weekStart: string;
  weekEnd: string;
  stocktakeCompleted: boolean;
  values: {
    netSales: number;
    openingStock: number;
    purchases: number;
    credits: number;
    transfersIn: number;
    transfersOut: number;
    closingStock: number;
    adjustments: number;
    wasteCost: number;
    staffCost: number;
    paidHours: number;
    pendingCredits: number;
    awaitingInvoice: number;
  };
  sources: {
    sales: { mode: string; reference: string; confirmed: boolean };
    purchasing: { mode: string; reference: string; confirmed: boolean };
    labour: { mode: string; reference: string; confirmed: boolean };
  };
  narrative: {
    wins: string;
    operationalIssues: string;
    staffingIssues: string;
    complianceIssues: string;
    equipmentIssues: string;
    actionsUnderway: string;
    supportNeeded: string;
  };
};

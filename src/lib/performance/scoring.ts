// Every performance calculation lives here so the UI, server actions and
// exports can never disagree about a score.

export type Rag = "green" | "amber" | "red" | "neutral";

export const SCORE_AREAS = [
  "leadership",
  "communication",
  "organisation",
  "kitchen_standards",
  "product_quality",
  "commercial_awareness",
  "problem_solving",
  "ownership",
] as const;

export type ScoreArea = (typeof SCORE_AREAS)[number];
export type ScoreMap = Partial<Record<ScoreArea, number | null | undefined>>;

const round1 = (value: number) => Math.round(value * 10) / 10;

export const scoreRag = (score: number | null | undefined): Rag => {
  if (score === null || score === undefined) return "neutral";
  if (score >= 4) return "green";
  if (score >= 3) return "amber";
  return "red";
};

const averageOf = (values: Array<number | null | undefined>): number | null => {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!present.length) return null;
  return round1(present.reduce((sum, value) => sum + value, 0) / present.length);
};

/** Mean of the completed scores only; empty scores are ignored, never zero. */
export const overallScore = (scores: ScoreMap): number | null =>
  averageOf(SCORE_AREAS.map((area) => scores[area]));

/** The five headline dashboard categories plus overall. */
export const dashboardCategories = (scores: ScoreMap) => ({
  leadership: averageOf([scores.leadership]),
  standards: averageOf([scores.communication, scores.organisation, scores.kitchen_standards]),
  commercial: averageOf([scores.commercial_awareness]),
  product: averageOf([scores.product_quality]),
  ownership: averageOf([scores.problem_solving, scores.ownership]),
  overall: overallScore(scores),
});

export type KpiDirection = "higher" | "lower";
export type KpiUnit = "currency" | "percentage_points" | "percentage";

export type KpiResult = {
  variance: number | null;
  rag: Rag;
};

/**
 * Variance and RAG for a numeric KPI.
 * Percentage KPIs (GP, labour, audit) compare in percentage points;
 * currency KPIs (sales, waste) use a proportional band of the target.
 */
export const kpiResult = (
  actual: number | null | undefined,
  target: number | null | undefined,
  direction: KpiDirection,
  unit: KpiUnit,
  bands: { amber: number },
): KpiResult => {
  if (actual === null || actual === undefined || target === null || target === undefined) {
    return { variance: null, rag: "neutral" };
  }
  const variance = round1(actual - target);
  const adverse = direction === "higher" ? target - actual : actual - target;
  if (adverse <= 0) return { variance, rag: "green" };

  if (unit === "percentage_points") {
    return { variance, rag: adverse <= bands.amber ? "amber" : "red" };
  }
  // Proportional band; a zero target cannot divide, so any adverse movement is red.
  if (target === 0) return { variance, rag: "red" };
  const adverseRatio = adverse / Math.abs(target);
  return { variance, rag: adverseRatio <= bands.amber ? "amber" : "red" };
};

export const salesKpi = (actual?: number | null, target?: number | null) =>
  kpiResult(actual, target, "higher", "currency", { amber: 0.05 });

export const foodGpKpi = (actual?: number | null, target?: number | null) =>
  kpiResult(actual, target, "higher", "percentage_points", { amber: 2 });

export const labourKpi = (actual?: number | null, target?: number | null) =>
  kpiResult(actual, target, "lower", "percentage_points", { amber: 2 });

export const wasteKpi = (actual?: number | null, target?: number | null) =>
  kpiResult(actual, target, "lower", "currency", { amber: 0.1 });

export const auditKpi = (actual?: number | null, target?: number | null) =>
  kpiResult(actual, target, "higher", "percentage_points", { amber: 5 });

export const booleanKpi = (value: boolean | null | undefined): Rag =>
  value === null || value === undefined ? "neutral" : value ? "green" : "red";

export type ProbationStage = "first_30" | "days_31_60" | "days_61_90" | "ongoing";

export const probationStage = (startDate: string, onDate: string): ProbationStage => {
  const start = new Date(`${startDate}T12:00:00Z`).valueOf();
  const current = new Date(`${onDate}T12:00:00Z`).valueOf();
  const daysEmployed = Math.floor((current - start) / 86_400_000) + 1;
  if (daysEmployed <= 30) return "first_30";
  if (daysEmployed <= 60) return "days_31_60";
  if (daysEmployed <= 90) return "days_61_90";
  return "ongoing";
};

export const probationStageLabel: Record<ProbationStage, string> = {
  first_30: "First 30 days",
  days_31_60: "Days 31–60",
  days_61_90: "Days 61–90",
  ongoing: "Ongoing",
};

/** Role-specific weighted probation score; weights must sum to 1. */
export const weightedProbationScore = (
  entries: Array<{ score: number | null | undefined; weight: number }>,
): number | null => {
  const present = entries.filter(
    (entry): entry is { score: number; weight: number } =>
      typeof entry.score === "number" && Number.isFinite(entry.score),
  );
  if (!present.length) return null;
  const weightSum = present.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightSum === 0) return null;
  return round1(present.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / weightSum);
};

export const isActionOverdue = (
  dueDate: string | null | undefined,
  status: string,
  today: string,
): boolean => Boolean(dueDate) && String(dueDate) < today && !["complete", "cancelled"].includes(status);

export type EmailInput = {
  firstName: string;
  weekCommencing: string;
  positives: string[];
  developmentAreas: string[];
  actions: Array<{ action: string; dueDate: string | null }>;
  support: string;
  nextReviewDate: string | null;
};

/** Plain-text 1-1 follow-up, ready to copy into any email client. */
export const buildFollowUpEmail = (input: EmailInput) => {
  const bullets = (items: string[]) => items.filter(Boolean).map((item) => `• ${item}`).join("\n");
  const priorities = input.actions
    .filter((item) => item.action.trim())
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.action}${item.dueDate ? ` — due ${item.dueDate}` : ""}`)
    .join("\n");
  return {
    subject: `Weekly 1-1 Summary – ${input.weekCommencing}`,
    body: [
      `Hi ${input.firstName},`,
      "",
      "Thanks for today's 1-1.",
      input.positives.some(Boolean) ? `\nKey positives\n\n${bullets(input.positives)}` : "",
      input.developmentAreas.some(Boolean) ? `\nDevelopment areas\n\n${bullets(input.developmentAreas)}` : "",
      priorities ? `\nAgreed priorities for next week\n\n${priorities}` : "",
      input.support.trim() ? `\nSupport agreed\n\n• ${input.support.trim()}` : "",
      input.nextReviewDate ? `\nWe'll review progress at next week's 1-1 on ${input.nextReviewDate}.` : "\nWe'll review progress at next week's 1-1.",
      "",
      "Thanks,",
      "",
      "Chris",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
};

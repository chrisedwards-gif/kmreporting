import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ManagerRecord = {
  id: string;
  fullName: string;
  roleTitle: string;
  siteId: string | null;
  siteName: string;
  startDate: string | null;
  focusAreas: string[];
  active: boolean;
};

export type ManagerAction = {
  id: string;
  managerId: string;
  priority: "high" | "medium" | "low";
  action: string;
  successMeasure: string;
  owner: string;
  dueDate: string | null;
  status: "not_started" | "in_progress" | "blocked" | "complete" | "cancelled";
  outcome: string;
  sourceReviewId: string | null;
};

export type OneToOneListItem = {
  id: string;
  managerId: string;
  managerName: string;
  weekCommencing: string;
  reviewDate: string | null;
  status: "draft" | "in_review" | "finalised" | "acknowledged" | "reopened";
  overallScore: number | null;
};

export type OneToOneDetail = OneToOneListItem & {
  wins: Record<string, string>;
  kpiManual: Record<string, string>;
  kpiSnapshot: Record<string, unknown> | null;
  summary: Record<string, string>;
  scores: Array<{ area: string; score: number | null; evidence: string; developmentNote: string }>;
};

export type WeekKpis = {
  available: boolean;
  netSales: number | null;
  foodGpPct: number | null;
  foodGpTarget: number | null;
  labourPct: number | null;
  labourTarget: number | null;
  wasteCost: number | null;
  stockCompleted: boolean | null;
  reportSent: boolean | null;
};

const demoManagers: ManagerRecord[] = [
  {
    id: "demo-scott", fullName: "Scott Hutton", roleTitle: "Kitchen Manager", siteId: "dough-religion",
    siteName: "Dough Religion", startDate: "2026-06-15", active: true,
    focusAreas: ["Product quality", "Dough and flour testing", "Menu development", "Greek concept development", "Specs and costings", "Team quality training"],
  },
  {
    id: "demo-warren", fullName: "Warren Raisbeck", roleTitle: "Kitchen Manager", siteId: "dough-religion",
    siteName: "Dough Religion", startDate: "2026-05-01", active: true,
    focusAreas: ["Operational ownership", "Stock taking", "Procure Wizard", "GP and waste", "Reporting", "SOPs", "Close-down standards", "Compliance", "Team accountability"],
  },
];

export async function getManagers(): Promise<ManagerRecord[]> {
  if (environment.isDemo) return demoManagers;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("managers")
    .select("id, full_name, role_title, site_id, start_date, focus_areas, active, sites (name)")
    .order("full_name");
  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    roleTitle: row.role_title,
    siteId: row.site_id,
    siteName: (row.sites as { name?: string } | null)?.name ?? "Unassigned",
    startDate: row.start_date,
    focusAreas: row.focus_areas ?? [],
    active: row.active,
  }));
}

export async function getOneToOnes(managerId?: string): Promise<OneToOneListItem[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  let query = supabase
    .from("one_to_one_reviews")
    .select("id, manager_id, week_commencing, review_date, status, overall_score, managers (full_name)")
    .order("week_commencing", { ascending: false })
    .limit(60);
  if (managerId) query = query.eq("manager_id", managerId);
  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    managerId: row.manager_id,
    managerName: (row.managers as { full_name?: string } | null)?.full_name ?? "Manager",
    weekCommencing: row.week_commencing,
    reviewDate: row.review_date,
    status: row.status,
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
  }));
}

export async function getOneToOne(reviewId: string): Promise<OneToOneDetail | null> {
  if (environment.isDemo) return null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const [{ data: review }, { data: scores }] = await Promise.all([
    supabase
      .from("one_to_one_reviews")
      .select("id, manager_id, week_commencing, review_date, status, overall_score, wins, kpi_manual, kpi_snapshot, summary, managers (full_name)")
      .eq("id", reviewId)
      .maybeSingle(),
    supabase.from("one_to_one_scores").select("area, score, evidence, development_note").eq("review_id", reviewId),
  ]);
  if (!review) return null;
  return {
    id: review.id,
    managerId: review.manager_id,
    managerName: (review.managers as { full_name?: string } | null)?.full_name ?? "Manager",
    weekCommencing: review.week_commencing,
    reviewDate: review.review_date,
    status: review.status,
    overallScore: review.overall_score === null ? null : Number(review.overall_score),
    wins: (review.wins ?? {}) as Record<string, string>,
    kpiManual: (review.kpi_manual ?? {}) as Record<string, string>,
    kpiSnapshot: (review.kpi_snapshot ?? null) as Record<string, unknown> | null,
    summary: (review.summary ?? {}) as Record<string, string>,
    scores: (scores ?? []).map((row) => ({
      area: row.area,
      score: row.score === null ? null : Number(row.score),
      evidence: row.evidence,
      developmentNote: row.development_note,
    })),
  };
}

/** Open actions for the manager — the carry-forward list for section 5. */
export async function getOpenActions(managerId: string): Promise<ManagerAction[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("manager_actions")
    .select("id, manager_id, priority, action, success_measure, owner, due_date, status, outcome, source_review_id")
    .eq("manager_id", managerId)
    .not("status", "in", "(complete,cancelled)")
    .order("due_date", { ascending: true, nullsFirst: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    managerId: row.manager_id,
    priority: row.priority,
    action: row.action,
    successMeasure: row.success_measure,
    owner: row.owner,
    dueDate: row.due_date,
    status: row.status,
    outcome: row.outcome,
    sourceReviewId: row.source_review_id,
  }));
}

/**
 * The streamlining core: the six operational KPIs already captured by the
 * weekly report system, pulled for the manager's kitchen and week. Nothing
 * here is re-typed in the meeting.
 */
export async function getWeekKpis(siteId: string | null, weekCommencing: string): Promise<WeekKpis> {
  const empty: WeekKpis = {
    available: false, netSales: null, foodGpPct: null, foodGpTarget: null,
    labourPct: null, labourTarget: null, wasteCost: null, stockCompleted: null, reportSent: null,
  };
  if (environment.isDemo || !siteId) return empty;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return empty;

  const { data: period } = await supabase
    .from("reporting_periods")
    .select("id")
    .eq("week_start", weekCommencing)
    .maybeSingle();
  if (!period) return empty;

  const [{ data: snapshot }, { data: site }, { data: report }] = await Promise.all([
    supabase
      .from("site_cost_snapshots")
      .select("net_sales, food_cost_pct, labour_pct, waste_cost, food_cost_basis")
      .eq("period_id", period.id)
      .eq("site_id", siteId)
      .maybeSingle(),
    supabase.from("sites").select("food_cost_target, labour_target").eq("id", siteId).maybeSingle(),
    supabase
      .from("weekly_reports")
      .select("status")
      .eq("period_id", period.id)
      .eq("site_id", siteId)
      .maybeSingle(),
  ]);
  if (!snapshot) return empty;
  return {
    available: true,
    netSales: Number(snapshot.net_sales),
    foodGpPct: Math.round((100 - Number(snapshot.food_cost_pct)) * 10) / 10,
    foodGpTarget: site ? Math.round((100 - Number(site.food_cost_target)) * 10) / 10 : null,
    labourPct: Number(snapshot.labour_pct),
    labourTarget: site ? Number(site.labour_target) : null,
    wasteCost: Number(snapshot.waste_cost),
    stockCompleted: snapshot.food_cost_basis === "stock_adjusted",
    reportSent: report ? ["submitted", "review_required", "approved", "shared"].includes(report.status) : false,
  };
}

/** Actions agreed in a specific review, for the follow-up email and read view. */
export async function getReviewActions(reviewId: string): Promise<ManagerAction[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("manager_actions")
    .select("id, manager_id, priority, action, success_measure, owner, due_date, status, outcome, source_review_id")
    .eq("source_review_id", reviewId)
    .order("priority");
  return (data ?? []).map((row) => ({
    id: row.id, managerId: row.manager_id, priority: row.priority, action: row.action,
    successMeasure: row.success_measure, owner: row.owner, dueDate: row.due_date,
    status: row.status, outcome: row.outcome, sourceReviewId: row.source_review_id,
  }));
}

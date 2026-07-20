import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ManagerRecord = {
  /** Canonical person UUID: profiles.id === auth.users.id. */
  id: string;
  assignmentId: string;
  fullName: string;
  roleTitle: string;
  siteId: string;
  siteName: string;
  startDate: string | null;
  focusAreas: string[];
  active: boolean;
  assignmentStartsOn: string;
  assignmentEndsOn: string | null;
};

export type ManagerAction = {
  id: string;
  managerId: string;
  siteId: string | null;
  assignmentId: string | null;
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
  assignmentId: string;
  siteId: string;
  managerName: string;
  siteName: string;
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

type AssignmentRow = {
  id: string;
  site_id: string;
  manager_profile_id: string;
  starts_on: string;
  ends_on: string | null;
};

type ActionRow = {
  id: string;
  manager_profile_id: string | null;
  site_id: string | null;
  assignment_id: string | null;
  priority: ManagerAction["priority"];
  action: string;
  success_measure: string;
  owner: string;
  due_date: string | null;
  status: ManagerAction["status"];
  outcome: string;
  source_review_id: string | null;
};

const demoManagers: ManagerRecord[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    assignmentId: "00000000-0000-4000-8000-000000000201",
    fullName: "Warren Raisbeck",
    roleTitle: "Kitchen Manager",
    siteId: "00000000-0000-4000-8000-000000000001",
    siteName: "Dough Religion",
    startDate: "2026-05-01",
    active: true,
    focusAreas: ["Operational ownership", "Stock taking", "Procure Wizard", "GP and waste", "Reporting", "SOPs", "Close-down standards", "Compliance", "Team accountability"],
    assignmentStartsOn: "2026-05-03",
    assignmentEndsOn: null,
  },
];

const mapAction = (row: ActionRow): ManagerAction => ({
  id: row.id,
  managerId: row.manager_profile_id ?? "",
  siteId: row.site_id,
  assignmentId: row.assignment_id,
  priority: row.priority,
  action: row.action,
  successMeasure: row.success_measure,
  owner: row.owner,
  dueDate: row.due_date,
  status: row.status,
  outcome: row.outcome,
  sourceReviewId: row.source_review_id,
});

const loadAssignmentRecords = async (assignments: AssignmentRow[]): Promise<ManagerRecord[]> => {
  if (!assignments.length) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const profileIds = [...new Set(assignments.map((item) => item.manager_profile_id))];
  const siteIds = [...new Set(assignments.map((item) => item.site_id))];
  const [{ data: profiles }, { data: sites }, { data: details }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, active").in("id", profileIds),
    supabase.from("sites").select("id, name").in("id", siteIds),
    supabase.from("manager_details").select("profile_id, role_title, employment_start_date, focus_areas").in("profile_id", profileIds),
  ]);
  const profilesById = new Map((profiles ?? []).map((item) => [item.id, item]));
  const sitesById = new Map((sites ?? []).map((item) => [item.id, item]));
  const detailsByProfile = new Map((details ?? []).map((item) => [item.profile_id, item]));

  return assignments.flatMap((assignment) => {
    const profile = profilesById.get(assignment.manager_profile_id);
    const site = sitesById.get(assignment.site_id);
    if (!profile || !site) return [];
    const detail = detailsByProfile.get(profile.id);
    return [{
      id: profile.id,
      assignmentId: assignment.id,
      fullName: profile.full_name,
      roleTitle: detail?.role_title ?? "Kitchen Manager",
      siteId: site.id,
      siteName: site.name,
      startDate: detail?.employment_start_date ?? null,
      focusAreas: detail?.focus_areas ?? [],
      active: Boolean(profile.active),
      assignmentStartsOn: assignment.starts_on,
      assignmentEndsOn: assignment.ends_on,
    }];
  });
};

/** Current primary kitchen-manager assignments, one card per kitchen. */
export async function getManagers(): Promise<ManagerRecord[]> {
  if (environment.isDemo) return demoManagers;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("site_manager_assignments")
    .select("id, site_id, manager_profile_id, starts_on, ends_on")
    .is("ends_on", null)
    .order("starts_on");
  if (error) return [];
  const records = await loadAssignmentRecords((data ?? []) as AssignmentRow[]);
  return records.sort((a, b) => a.siteName.localeCompare(b.siteName));
}

export async function getManagerAssignment(assignmentId: string): Promise<ManagerRecord | null> {
  if (environment.isDemo) return demoManagers.find((item) => item.assignmentId === assignmentId) ?? null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("site_manager_assignments")
    .select("id, site_id, manager_profile_id, starts_on, ends_on")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error || !data) return null;
  return (await loadAssignmentRecords([data as AssignmentRow]))[0] ?? null;
}

export async function getOneToOnes(managerId?: string): Promise<OneToOneListItem[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  let query = supabase
    .from("one_to_one_reviews")
    .select("id, manager_profile_id, assignment_id, site_id, week_commencing, review_date, status, overall_score")
    .not("manager_profile_id", "is", null)
    .not("assignment_id", "is", null)
    .not("site_id", "is", null)
    .order("week_commencing", { ascending: false })
    .limit(100);
  if (managerId) query = query.eq("manager_profile_id", managerId);
  const { data, error } = await query;
  if (error || !data?.length) return [];

  const profileIds = [...new Set(data.map((row) => row.manager_profile_id as string))];
  const siteIds = [...new Set(data.map((row) => row.site_id as string))];
  const [{ data: profiles }, { data: sites }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", profileIds),
    supabase.from("sites").select("id, name").in("id", siteIds),
  ]);
  const profilesById = new Map((profiles ?? []).map((item) => [item.id, item.full_name]));
  const sitesById = new Map((sites ?? []).map((item) => [item.id, item.name]));

  return data.map((row) => ({
    id: row.id,
    managerId: row.manager_profile_id as string,
    assignmentId: row.assignment_id as string,
    siteId: row.site_id as string,
    managerName: profilesById.get(row.manager_profile_id as string) ?? "Manager",
    siteName: sitesById.get(row.site_id as string) ?? "Kitchen",
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
  const [{ data: review, error }, { data: scores }] = await Promise.all([
    supabase
      .from("one_to_one_reviews")
      .select("id, manager_profile_id, assignment_id, site_id, week_commencing, review_date, status, overall_score, wins, kpi_manual, kpi_snapshot, summary")
      .eq("id", reviewId)
      .maybeSingle(),
    supabase.from("one_to_one_scores").select("area, score, evidence, development_note").eq("review_id", reviewId),
  ]);
  if (error || !review?.manager_profile_id || !review.assignment_id || !review.site_id) return null;
  const [{ data: profile }, { data: site }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", review.manager_profile_id).maybeSingle(),
    supabase.from("sites").select("name").eq("id", review.site_id).maybeSingle(),
  ]);
  return {
    id: review.id,
    managerId: review.manager_profile_id,
    assignmentId: review.assignment_id,
    siteId: review.site_id,
    managerName: profile?.full_name ?? "Manager",
    siteName: site?.name ?? "Kitchen",
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

/** Open actions follow the canonical person UUID, even when that person moves site. */
export async function getOpenActions(managerId: string): Promise<ManagerAction[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("manager_actions")
    .select("id, manager_profile_id, site_id, assignment_id, priority, action, success_measure, owner, due_date, status, outcome, source_review_id")
    .eq("manager_profile_id", managerId)
    .not("status", "in", "(complete,cancelled)")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) return [];
  return ((data ?? []) as ActionRow[]).map(mapAction);
}

/**
 * The streamlining core: operational KPIs already captured by the weekly
 * report, pulled by the review's immutable site UUID and week.
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

export function getSnapshottedKpis(snapshot: Record<string, unknown> | null): WeekKpis | null {
  if (!snapshot || snapshot.available !== true) return null;
  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const booleanOrNull = (value: unknown) => typeof value === "boolean" ? value : null;
  return {
    available: true,
    netSales: numberOrNull(snapshot.netSales),
    foodGpPct: numberOrNull(snapshot.foodGpPct),
    foodGpTarget: numberOrNull(snapshot.foodGpTarget),
    labourPct: numberOrNull(snapshot.labourPct),
    labourTarget: numberOrNull(snapshot.labourTarget),
    wasteCost: numberOrNull(snapshot.wasteCost),
    stockCompleted: booleanOrNull(snapshot.stockCompleted),
    reportSent: booleanOrNull(snapshot.reportSent),
  };
}

/** Actions associated with a review through the durable review/action link. */
export async function getReviewActions(reviewId: string): Promise<ManagerAction[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data: links, error } = await supabase
    .from("one_to_one_action_links")
    .select("action_id, position")
    .eq("review_id", reviewId)
    .order("position");
  if (error || !links?.length) return [];
  const actionIds = links.map((item) => item.action_id);
  const { data: actions } = await supabase
    .from("manager_actions")
    .select("id, manager_profile_id, site_id, assignment_id, priority, action, success_measure, owner, due_date, status, outcome, source_review_id")
    .in("id", actionIds);
  const byId = new Map(((actions ?? []) as ActionRow[]).map((row) => [row.id, mapAction(row)]));
  return links.flatMap((link) => {
    const action = byId.get(link.action_id);
    return action ? [action] : [];
  });
}

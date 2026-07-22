import "server-only";

import { getEvidenceFiles, type EvidenceFile } from "@/lib/data/evidence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  dashboardCategories,
  probationStage,
  probationStageLabel,
  SCORE_AREAS,
  weightedProbationScore,
  scoreRag,
  type ProbationStage,
  type Rag,
  type ScoreArea,
  type ScoreMap,
} from "@/lib/performance/scoring";

export type PerformanceTrendPoint = {
  reviewId: string;
  managerId: string;
  managerName: string;
  siteName: string;
  weekCommencing: string;
  overall: number;
  leadership: number | null;
  standards: number | null;
  commercial: number | null;
  product: number | null;
  ownership: number | null;
};

export type PerformanceActionItem = {
  id: string;
  managerId: string;
  managerName: string;
  siteId: string | null;
  siteName: string;
  priority: "high" | "medium" | "low";
  action: string;
  successMeasure: string;
  owner: string;
  dueDate: string | null;
  status: "not_started" | "in_progress" | "blocked" | "complete" | "cancelled";
  outcome: string;
  reviewId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RagOverrideRecord = {
  id: string;
  calculatedRag: Rag;
  overrideRag: Rag;
  reason: string;
  createdByName: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string;
};

export type ProbationReviewStage = "30_day" | "60_day" | "90_day" | "final" | "other";
export type ProbationOutcome = "pending" | "pass" | "extend" | "fail";

export type ProbationReviewRecord = {
  id: string;
  managerProfileId: string;
  siteId: string | null;
  siteName: string;
  reviewDate: string;
  reviewStage: ProbationReviewStage;
  status: "draft" | "finalised";
  outcome: ProbationOutcome;
  extensionEndDate: string | null;
  notes: string;
  requiredActions: string;
  scoreSnapshot: number | null;
  ragSnapshot: Rag | null;
  finalisedAt: string | null;
  finalisedByName: string | null;
  evidence: EvidenceFile[];
};

export type ProbationSummary = {
  managerId: string;
  fullName: string;
  roleTitle: string;
  siteId: string | null;
  siteName: string;
  employmentStartDate: string | null;
  probationEndDate: string | null;
  stage: ProbationStage | null;
  stageLabel: string;
  weightedScore: number | null;
  calculatedRag: Rag;
  displayRag: Rag;
  activeOverride: RagOverrideRecord | null;
  overrideHistory: RagOverrideRecord[];
  reviewCount: number;
  latestReviewDate: string | null;
  weights: Record<ScoreArea, number>;
  probationReviews: ProbationReviewRecord[];
};

export type ManagerAdminRecord = {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  roleTitle: string;
  employmentStartDate: string | null;
  probationEndDate: string | null;
  focusAreas: string[];
  currentSite: string | null;
  currentAssignmentId: string | null;
};

type ReviewRow = {
  id: string;
  manager_profile_id: string;
  site_id: string;
  week_commencing: string;
  overall_score: number | string | null;
};

type ScoreRow = {
  review_id: string;
  area: ScoreArea;
  score: number | string | null;
};

const defaultWeights: Record<ScoreArea, number> = {
  leadership: 0.15,
  communication: 0.10,
  organisation: 0.15,
  kitchen_standards: 0.20,
  product_quality: 0.15,
  commercial_awareness: 0.10,
  problem_solving: 0.05,
  ownership: 0.10,
};

const numberOrNull = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export async function getPerformanceTrends(managerId?: string): Promise<PerformanceTrendPoint[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  let query = supabase
    .from("one_to_one_reviews")
    .select("id, manager_profile_id, site_id, week_commencing, overall_score")
    .in("status", ["finalised", "acknowledged"])
    .not("overall_score", "is", null)
    .not("manager_profile_id", "is", null)
    .not("site_id", "is", null)
    .order("week_commencing", { ascending: true })
    .limit(250);
  if (managerId) query = query.eq("manager_profile_id", managerId);
  const { data: reviews, error } = await query;
  if (error || !reviews?.length) return [];

  const reviewRows = reviews as ReviewRow[];
  const reviewIds = reviewRows.map((review) => review.id);
  const profileIds = [...new Set(reviewRows.map((review) => review.manager_profile_id))];
  const siteIds = [...new Set(reviewRows.map((review) => review.site_id))];
  const [{ data: scores }, { data: profiles }, { data: sites }] = await Promise.all([
    supabase.from("one_to_one_scores").select("review_id, area, score").in("review_id", reviewIds),
    supabase.from("profiles").select("id, full_name").in("id", profileIds),
    supabase.from("sites").select("id, name").in("id", siteIds),
  ]);
  const scoreMaps = new Map<string, ScoreMap>();
  for (const row of (scores ?? []) as ScoreRow[]) {
    const current = scoreMaps.get(row.review_id) ?? {};
    current[row.area] = numberOrNull(row.score);
    scoreMaps.set(row.review_id, current);
  }
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const siteMap = new Map((sites ?? []).map((site) => [site.id, site.name]));

  return reviewRows.flatMap((review) => {
    const overall = numberOrNull(review.overall_score);
    if (overall === null) return [];
    const categories = dashboardCategories(scoreMaps.get(review.id) ?? {});
    return [{
      reviewId: review.id,
      managerId: review.manager_profile_id,
      managerName: profileMap.get(review.manager_profile_id) ?? "Manager",
      siteName: siteMap.get(review.site_id) ?? "Kitchen",
      weekCommencing: review.week_commencing,
      overall,
      leadership: categories.leadership,
      standards: categories.standards,
      commercial: categories.commercial,
      product: categories.product,
      ownership: categories.ownership,
    }];
  });
}

export async function getPerformanceActions(): Promise<PerformanceActionItem[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data: actions, error } = await supabase
    .from("manager_actions")
    .select("id, manager_profile_id, site_id, priority, action, success_measure, owner, due_date, status, outcome, source_review_id, created_at, updated_at")
    .not("manager_profile_id", "is", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (error || !actions?.length) return [];

  const profileIds = [...new Set(actions.map((action) => action.manager_profile_id as string))];
  const siteIds = [...new Set(actions.map((action) => action.site_id as string).filter(Boolean))];
  const [{ data: profiles }, { data: sites }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", profileIds),
    siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
  ]);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const siteMap = new Map((sites ?? []).map((site) => [site.id, site.name]));

  return actions.map((action) => ({
    id: action.id,
    managerId: action.manager_profile_id as string,
    managerName: profileMap.get(action.manager_profile_id as string) ?? "Manager",
    siteId: action.site_id,
    siteName: action.site_id ? siteMap.get(action.site_id) ?? "Kitchen" : "No kitchen",
    priority: action.priority,
    action: action.action,
    successMeasure: action.success_measure,
    owner: action.owner,
    dueDate: action.due_date,
    status: action.status,
    outcome: action.outcome,
    reviewId: action.source_review_id,
    createdAt: action.created_at,
    updatedAt: action.updated_at,
  }));
}

export async function getProbationSummaries(today = new Date().toISOString().slice(0, 10)): Promise<ProbationSummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data: details, error } = await supabase
    .from("manager_details")
    .select("profile_id, role_title, employment_start_date, probation_end_date, probation_weights")
    .order("employment_start_date", { ascending: true, nullsFirst: false });
  if (error || !details?.length) return [];

  const profileIds = details.map((detail) => detail.profile_id);
  const [{ data: profiles }, { data: assignments }, { data: reviews }, { data: probationRows }, { data: overrideRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", profileIds),
    supabase.from("site_manager_assignments").select("manager_profile_id, site_id").in("manager_profile_id", profileIds).is("ends_on", null),
    supabase
      .from("one_to_one_reviews")
      .select("id, manager_profile_id, week_commencing")
      .in("manager_profile_id", profileIds)
      .in("status", ["finalised", "acknowledged"])
      .order("week_commencing", { ascending: false }),
    supabase
      .from("probation_reviews")
      .select("id, manager_profile_id, site_id, review_date, review_stage, status, outcome, extension_end_date, notes, required_actions, score_snapshot, rag_snapshot, finalised_at, finalised_by")
      .in("manager_profile_id", profileIds)
      .order("review_date", { ascending: false }),
    supabase
      .from("rag_overrides")
      .select("id, entity_id, calculated_rag, override_rag, reason, created_by, created_at, revoked_by, revoked_at, revoke_reason")
      .eq("entity_type", "manager_probation")
      .eq("metric_key", "weighted_score")
      .in("entity_id", profileIds)
      .order("created_at", { ascending: false }),
  ]);

  const reviewIds = (reviews ?? []).map((review) => review.id);
  const probationIds = (probationRows ?? []).map((review) => review.id);
  const siteIds = [...new Set([
    ...(assignments ?? []).map((assignment) => assignment.site_id),
    ...(probationRows ?? []).flatMap((review) => review.site_id ? [review.site_id] : []),
  ])];
  const actorIds = [...new Set([
    ...(probationRows ?? []).flatMap((review) => review.finalised_by ? [review.finalised_by] : []),
    ...(overrideRows ?? []).flatMap((override) => [override.created_by, override.revoked_by].filter((id): id is string => Boolean(id))),
  ])];
  const [{ data: scores }, { data: sites }, { data: actors }, evidenceByReview] = await Promise.all([
    reviewIds.length ? supabase.from("one_to_one_scores").select("review_id, area, score").in("review_id", reviewIds) : Promise.resolve({ data: [] }),
    siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
    actorIds.length ? supabase.from("profiles").select("id, full_name").in("id", actorIds) : Promise.resolve({ data: [] }),
    getEvidenceFiles("probation_review", probationIds),
  ]);

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const actorMap = new Map((actors ?? []).map((profile) => [profile.id, profile.full_name]));
  const siteMap = new Map((sites ?? []).map((site) => [site.id, site.name]));
  const assignmentMap = new Map((assignments ?? []).map((assignment) => [assignment.manager_profile_id, assignment.site_id]));
  const reviewsByManager = new Map<string, Array<{ id: string; week_commencing: string }>>();
  for (const review of reviews ?? []) {
    const current = reviewsByManager.get(review.manager_profile_id) ?? [];
    current.push({ id: review.id, week_commencing: review.week_commencing });
    reviewsByManager.set(review.manager_profile_id, current);
  }
  const scoresByReview = new Map<string, ScoreMap>();
  for (const row of (scores ?? []) as ScoreRow[]) {
    const current = scoresByReview.get(row.review_id) ?? {};
    current[row.area] = numberOrNull(row.score);
    scoresByReview.set(row.review_id, current);
  }

  const probationByManager = new Map<string, ProbationReviewRecord[]>();
  for (const row of probationRows ?? []) {
    const current = probationByManager.get(row.manager_profile_id) ?? [];
    current.push({
      id: row.id,
      managerProfileId: row.manager_profile_id,
      siteId: row.site_id,
      siteName: row.site_id ? siteMap.get(row.site_id) ?? "Kitchen" : "No kitchen recorded",
      reviewDate: row.review_date,
      reviewStage: row.review_stage as ProbationReviewStage,
      status: row.status as "draft" | "finalised",
      outcome: row.outcome as ProbationOutcome,
      extensionEndDate: row.extension_end_date,
      notes: row.notes,
      requiredActions: row.required_actions,
      scoreSnapshot: numberOrNull(row.score_snapshot),
      ragSnapshot: row.rag_snapshot as Rag | null,
      finalisedAt: row.finalised_at,
      finalisedByName: row.finalised_by ? actorMap.get(row.finalised_by) ?? "Group management" : null,
      evidence: evidenceByReview[row.id] ?? [],
    });
    probationByManager.set(row.manager_profile_id, current);
  }

  const overrideHistoryByManager = new Map<string, RagOverrideRecord[]>();
  for (const row of overrideRows ?? []) {
    const current = overrideHistoryByManager.get(row.entity_id) ?? [];
    current.push({
      id: row.id,
      calculatedRag: row.calculated_rag as Rag,
      overrideRag: row.override_rag as Rag,
      reason: row.reason,
      createdByName: row.created_by ? actorMap.get(row.created_by) ?? "Group management" : "Group management",
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      revokedByName: row.revoked_by ? actorMap.get(row.revoked_by) ?? "Group management" : null,
      revokeReason: row.revoke_reason ?? "",
    });
    overrideHistoryByManager.set(row.entity_id, current);
  }

  return details.map((detail) => {
    const managerReviews = reviewsByManager.get(detail.profile_id) ?? [];
    const latest = managerReviews[0] ?? null;
    const latestScores = latest ? scoresByReview.get(latest.id) ?? {} : {};
    const rawWeights = (detail.probation_weights ?? {}) as Partial<Record<ScoreArea, number>>;
    const weights = Object.fromEntries(
      SCORE_AREAS.map((area) => [area, Number(rawWeights[area] ?? defaultWeights[area])]),
    ) as Record<ScoreArea, number>;
    const weightedScore = weightedProbationScore(
      SCORE_AREAS.map((area) => ({ score: latestScores[area], weight: weights[area] })),
    );
    const calculatedRag = scoreRag(weightedScore);
    const overrideHistory = overrideHistoryByManager.get(detail.profile_id) ?? [];
    const activeOverride = overrideHistory.find((override) => !override.revokedAt) ?? null;
    const stage = detail.employment_start_date ? probationStage(detail.employment_start_date, today) : null;
    const siteId = assignmentMap.get(detail.profile_id) ?? null;
    return {
      managerId: detail.profile_id,
      fullName: profileMap.get(detail.profile_id) ?? "Manager",
      roleTitle: detail.role_title,
      siteId,
      siteName: siteId ? siteMap.get(siteId) ?? "Kitchen" : "Not currently assigned",
      employmentStartDate: detail.employment_start_date,
      probationEndDate: detail.probation_end_date,
      stage,
      stageLabel: stage ? probationStageLabel[stage] : "Start date not set",
      weightedScore,
      calculatedRag,
      displayRag: activeOverride?.overrideRag ?? calculatedRag,
      activeOverride,
      overrideHistory,
      reviewCount: managerReviews.length,
      latestReviewDate: latest?.week_commencing ?? null,
      weights,
      probationReviews: probationByManager.get(detail.profile_id) ?? [],
    };
  });
}

export async function getManagerAdminRecords(): Promise<ManagerAdminRecord[]> {
  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, notification_email, active")
    .eq("role", "kitchen_manager")
    .order("full_name");
  if (error || !profiles?.length) return [];
  const profileIds = profiles.map((profile) => profile.id);
  const [{ data: details }, { data: assignments }] = await Promise.all([
    admin.from("manager_details").select("profile_id, role_title, employment_start_date, probation_end_date, focus_areas").in("profile_id", profileIds),
    admin.from("site_manager_assignments").select("id, manager_profile_id, site_id").in("manager_profile_id", profileIds).is("ends_on", null),
  ]);
  const siteIds = [...new Set((assignments ?? []).map((assignment) => assignment.site_id))];
  const { data: sites } = siteIds.length
    ? await admin.from("sites").select("id, name").in("id", siteIds)
    : { data: [] };
  const detailsMap = new Map((details ?? []).map((detail) => [detail.profile_id, detail]));
  const assignmentMap = new Map((assignments ?? []).map((assignment) => [assignment.manager_profile_id, assignment]));
  const siteMap = new Map((sites ?? []).map((site) => [site.id, site.name]));

  return profiles.map((profile) => {
    const detail = detailsMap.get(profile.id);
    const assignment = assignmentMap.get(profile.id);
    return {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.notification_email ?? "",
      active: profile.active,
      roleTitle: detail?.role_title ?? "Kitchen Manager",
      employmentStartDate: detail?.employment_start_date ?? null,
      probationEndDate: detail?.probation_end_date ?? null,
      focusAreas: detail?.focus_areas ?? [],
      currentSite: assignment ? siteMap.get(assignment.site_id) ?? "Kitchen" : null,
      currentAssignmentId: assignment?.id ?? null,
    };
  });
}

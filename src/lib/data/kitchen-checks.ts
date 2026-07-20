import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type KitchenCheckCadence = "daily" | "weekly";
export type KitchenCheckRating = "green" | "amber" | "red" | "na";
export type KitchenCheckStatus = "draft" | "submitted" | "reviewed" | "reopened";
export type KitchenCheckResult = "in_progress" | "pass" | "watch" | "fail";

export type KitchenCheckTemplateSummary = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  description: string;
  cadence: KitchenCheckCadence;
  version: number;
  passThreshold: number;
  watchThreshold: number;
  itemCount: number;
};

export type KitchenCheckRunSummary = {
  id: string;
  templateId: string;
  templateName: string;
  siteId: string;
  siteName: string;
  cadence: KitchenCheckCadence;
  periodStart: string;
  periodEnd: string;
  status: KitchenCheckStatus;
  percentage: number | null;
  result: KitchenCheckResult;
  criticalFail: boolean;
  answeredCount: number;
  requiredCount: number;
  issueCount: number;
  submittedAt: string | null;
  updatedAt: string;
};

export type KitchenCheckItem = {
  id: string;
  sectionId: string;
  subgroup: string | null;
  title: string;
  standard: string;
  critical: boolean;
  required: boolean;
  maxPoints: number;
  sortOrder: number;
};

export type KitchenCheckSection = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  items: KitchenCheckItem[];
};

export type KitchenCheckResponse = {
  id: string | null;
  itemId: string;
  rating: KitchenCheckRating | null;
  points: number | null;
  notes: string;
  actionText: string;
  ownerProfileId: string;
  dueDate: string;
  managerActionId: string | null;
};

export type KitchenCheckOwner = {
  id: string;
  name: string;
};

export type KitchenCheckDetail = KitchenCheckRunSummary & {
  templateVersion: number;
  description: string;
  passThreshold: number;
  watchThreshold: number;
  requireActions: boolean;
  sections: KitchenCheckSection[];
  responses: KitchenCheckResponse[];
  owners: KitchenCheckOwner[];
  reviewNotes: string;
};

type TemplateRow = {
  id: string;
  site_id: string;
  name: string;
  description: string;
  cadence: KitchenCheckCadence;
  version: number;
  pass_threshold: number | string;
  watch_threshold: number | string;
};

type RunRow = {
  id: string;
  template_id: string;
  site_id: string;
  cadence: KitchenCheckCadence;
  period_start: string;
  period_end: string;
  status: KitchenCheckStatus;
  percentage: number | string | null;
  result: KitchenCheckResult;
  critical_fail: boolean;
  answered_count: number;
  required_count: number;
  issue_count: number;
  submitted_at: string | null;
  updated_at: string;
};

export async function getKitchenCheckDashboard(): Promise<{
  templates: KitchenCheckTemplateSummary[];
  runs: KitchenCheckRunSummary[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { templates: [], runs: [] };

  const [{ data: templates, error: templateError }, { data: runs, error: runError }] = await Promise.all([
    supabase
      .from("kitchen_check_templates")
      .select("id, site_id, name, description, cadence, version, pass_threshold, watch_threshold")
      .eq("active", true)
      .order("site_id")
      .order("cadence"),
    supabase
      .from("kitchen_check_runs")
      .select("id, template_id, site_id, cadence, period_start, period_end, status, percentage, result, critical_fail, answered_count, required_count, issue_count, submitted_at, updated_at")
      .order("period_start", { ascending: false })
      .limit(120),
  ]);
  if (templateError || runError) return { templates: [], runs: [] };

  const templateRows = (templates ?? []) as TemplateRow[];
  const runRows = (runs ?? []) as RunRow[];
  const siteIds = [...new Set([...templateRows.map((item) => item.site_id), ...runRows.map((item) => item.site_id)])];
  const templateIds = templateRows.map((item) => item.id);
  const [{ data: sites }, { data: items }] = await Promise.all([
    siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
    templateIds.length ? supabase.from("kitchen_check_items").select("template_id").in("template_id", templateIds) : Promise.resolve({ data: [] }),
  ]);
  const siteNames = new Map((sites ?? []).map((site) => [site.id, site.name]));
  const counts = new Map<string, number>();
  for (const item of items ?? []) counts.set(item.template_id, (counts.get(item.template_id) ?? 0) + 1);
  const templatesById = new Map(templateRows.map((item) => [item.id, item]));

  return {
    templates: templateRows.map((item) => ({
      id: item.id,
      siteId: item.site_id,
      siteName: siteNames.get(item.site_id) ?? "Kitchen",
      name: item.name,
      description: item.description,
      cadence: item.cadence,
      version: item.version,
      passThreshold: Number(item.pass_threshold),
      watchThreshold: Number(item.watch_threshold),
      itemCount: counts.get(item.id) ?? 0,
    })),
    runs: runRows.map((run) => ({
      id: run.id,
      templateId: run.template_id,
      templateName: templatesById.get(run.template_id)?.name ?? "Kitchen check",
      siteId: run.site_id,
      siteName: siteNames.get(run.site_id) ?? "Kitchen",
      cadence: run.cadence,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      status: run.status,
      percentage: run.percentage === null ? null : Number(run.percentage),
      result: run.result,
      criticalFail: run.critical_fail,
      answeredCount: run.answered_count,
      requiredCount: run.required_count,
      issueCount: run.issue_count,
      submittedAt: run.submitted_at,
      updatedAt: run.updated_at,
    })),
  };
}

export async function getKitchenCheckRun(runId: string): Promise<KitchenCheckDetail | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: run, error } = await supabase
    .from("kitchen_check_runs")
    .select("id, template_id, template_version, site_id, cadence, period_start, period_end, status, percentage, result, critical_fail, answered_count, required_count, issue_count, submitted_at, updated_at, review_notes")
    .eq("id", runId)
    .maybeSingle();
  if (error || !run) return null;

  const [{ data: template }, { data: site }, { data: sections }, { data: items }, { data: responses }, { data: assignments }] = await Promise.all([
    supabase
      .from("kitchen_check_templates")
      .select("name, description, require_actions, pass_threshold, watch_threshold")
      .eq("id", run.template_id)
      .maybeSingle(),
    supabase.from("sites").select("name").eq("id", run.site_id).maybeSingle(),
    supabase
      .from("kitchen_check_sections")
      .select("id, title, description, sort_order")
      .eq("template_id", run.template_id)
      .order("sort_order"),
    supabase
      .from("kitchen_check_items")
      .select("id, section_id, subgroup, title, standard, critical, required, max_points, sort_order")
      .eq("template_id", run.template_id)
      .order("sort_order"),
    supabase
      .from("kitchen_check_responses")
      .select("id, item_id, rating, points, notes, action_text, action_owner_profile_id, action_due_date, manager_action_id")
      .eq("run_id", runId),
    supabase
      .from("site_manager_assignments")
      .select("manager_profile_id")
      .eq("site_id", run.site_id)
      .is("ends_on", null),
  ]);
  if (!template) return null;

  const ownerIds = [...new Set((assignments ?? []).map((item) => item.manager_profile_id))];
  const { data: profiles } = ownerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
    : { data: [] };

  const itemRows: KitchenCheckItem[] = (items ?? []).map((item) => ({
    id: item.id,
    sectionId: item.section_id,
    subgroup: item.subgroup,
    title: item.title,
    standard: item.standard,
    critical: item.critical,
    required: item.required,
    maxPoints: Number(item.max_points),
    sortOrder: item.sort_order,
  }));

  return {
    id: run.id,
    templateId: run.template_id,
    templateName: template.name,
    siteId: run.site_id,
    siteName: site?.name ?? "Kitchen",
    cadence: run.cadence,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    status: run.status,
    percentage: run.percentage === null ? null : Number(run.percentage),
    result: run.result,
    criticalFail: run.critical_fail,
    answeredCount: run.answered_count,
    requiredCount: run.required_count,
    issueCount: run.issue_count,
    submittedAt: run.submitted_at,
    updatedAt: run.updated_at,
    templateVersion: run.template_version,
    description: template.description,
    passThreshold: Number(template.pass_threshold),
    watchThreshold: Number(template.watch_threshold),
    requireActions: template.require_actions,
    sections: (sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      sortOrder: section.sort_order,
      items: itemRows.filter((item) => item.sectionId === section.id),
    })),
    responses: (responses ?? []).map((response) => ({
      id: response.id,
      itemId: response.item_id,
      rating: response.rating as KitchenCheckRating | null,
      points: response.points === null ? null : Number(response.points),
      notes: response.notes,
      actionText: response.action_text,
      ownerProfileId: response.action_owner_profile_id ?? "",
      dueDate: response.action_due_date ?? "",
      managerActionId: response.manager_action_id,
    })),
    owners: (profiles ?? []).map((profile) => ({ id: profile.id, name: profile.full_name })),
    reviewNotes: run.review_notes,
  };
}

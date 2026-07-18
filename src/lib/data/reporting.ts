import "server-only";

import { environment } from "@/lib/env";
import { demoReports, demoSites, demoWeek } from "@/lib/demo/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole, ReportStatus, ReportingWeek, ReviewFlag, SitePerformance, WeeklyReport } from "@/lib/types";

export type ReportingBundle = {
  week: ReportingWeek;
  sites: SitePerformance[];
  reports: WeeklyReport[];
};

type DbReport = {
  id: string;
  site_id: string;
  manager_id: string;
  status: ReportStatus;
  wins: string;
  operational_issues: string;
  staffing_issues: string;
  compliance_issues: string;
  equipment_issues: string;
  actions_underway: string;
  support_needed: string;
  submitted_at: string | null;
  updated_at: string;
};

export async function getReportingBundle(): Promise<ReportingBundle> {
  if (environment.isDemo) return { week: demoWeek, sites: demoSites, reports: demoReports };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { week: demoWeek, sites: [], reports: [] };

  const { data: period } = await supabase
    .from("reporting_periods")
    .select("id, week_start, week_end, due_at")
    .order("week_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!period) return { week: demoWeek, sites: [], reports: [] };

  const { data: rawReports, error: reportError } = await supabase
    .from("weekly_reports")
    .select("id, site_id, manager_id, status, wins, operational_issues, staffing_issues, compliance_issues, equipment_issues, actions_underway, support_needed, submitted_at, updated_at")
    .eq("period_id", period.id);
  if (reportError) throw new Error("Unable to load weekly reports.");
  const reports = (rawReports ?? []) as DbReport[];
  const siteIds = [...new Set(reports.map((report) => report.site_id))];
  const managerIds = [...new Set(reports.map((report) => report.manager_id))];

  const [{ data: rawSites }, { data: rawProfiles }, { data: rawSnapshots }] = await Promise.all([
    siteIds.length
      ? supabase.from("sites").select("id, code, name, food_cost_target, labour_target, waste_target").in("id", siteIds)
      : Promise.resolve({ data: [] }),
    managerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", managerIds)
      : Promise.resolve({ data: [] }),
    supabase.from("site_cost_snapshots").select("report_id, site_id, net_sales, cogs, food_cost_pct, staff_cost, labour_pct, waste_cost, waste_pct, prime_cost, prime_cost_pct, review_flags").eq("period_id", period.id),
  ]);

  const sitesById = new Map((rawSites ?? []).map((site) => [site.id, site]));
  const profilesById = new Map((rawProfiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const snapshotsByReport = new Map((rawSnapshots ?? []).map((snapshot) => [snapshot.report_id, snapshot]));

  const performance: SitePerformance[] = reports.map((report) => {
    const site = sitesById.get(report.site_id);
    const snapshot = snapshotsByReport.get(report.id);
    return {
      reportId: report.id,
      id: report.site_id,
      code: site?.code ?? "SITE",
      name: site?.name ?? "Kitchen",
      manager: profilesById.get(report.manager_id) ?? "Unassigned",
      netSales: Number(snapshot?.net_sales ?? 0),
      cogs: Number(snapshot?.cogs ?? 0),
      foodCostPct: Number(snapshot?.food_cost_pct ?? 0),
      staffCost: Number(snapshot?.staff_cost ?? 0),
      labourPct: Number(snapshot?.labour_pct ?? 0),
      wastePct: Number(snapshot?.waste_pct ?? 0),
      primeCost: Number(snapshot?.prime_cost ?? 0),
      primeCostPct: Number(snapshot?.prime_cost_pct ?? 0),
      foodCostTarget: Number(site?.food_cost_target ?? 0),
      labourTarget: Number(site?.labour_target ?? 0),
      wasteTarget: Number(site?.waste_target ?? 0),
      status: report.status,
      flags: ((snapshot?.review_flags ?? []) as ReviewFlag[]).map((flag) => ({
        ...flag,
        detail: flag.detail ?? "This check must be resolved before approval.",
      })),
    };
  });

  const performanceByReport = new Map(performance.map((site) => [site.reportId, site]));
  const weeklyReports: WeeklyReport[] = reports.map((report) => ({
    id: report.id,
    siteId: report.site_id,
    siteName: sitesById.get(report.site_id)?.name ?? "Kitchen",
    manager: profilesById.get(report.manager_id) ?? "Unassigned",
    weekStart: period.week_start,
    weekEnd: period.week_end,
    status: report.status,
    updatedAt: report.updated_at,
    submittedAt: report.submitted_at ?? undefined,
    wins: report.wins,
    operationalIssues: report.operational_issues,
    staffingIssues: report.staffing_issues,
    complianceIssues: report.compliance_issues,
    equipmentIssues: report.equipment_issues,
    actionsUnderway: report.actions_underway,
    supportNeeded: report.support_needed,
    costs: performanceByReport.get(report.id)!,
  })).filter((report) => Boolean(report.costs));

  return {
    week: { id: period.id, start: period.week_start, end: period.week_end, dueAt: period.due_at },
    sites: performance,
    reports: weeklyReports,
  };
}

export async function getAccessibleSites() {
  if (environment.isDemo) {
    return [
      { id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR" },
      { id: "00000000-0000-4000-8000-000000000002", name: "Choi Wan", code: "CW-MCR" },
      { id: "00000000-0000-4000-8000-000000000003", name: "Kardia", code: "KAR-MCR" },
    ];
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("sites").select("id, name, code").eq("active", true).order("name");
  return data ?? [];
}

export async function getSiteDirectory() {
  if (environment.isDemo) {
    return [
      { id: "1", code: "DR-MCR", name: "Dough Religion", active: true },
      { id: "2", code: "CW-MCR", name: "Choi Wan", active: true },
      { id: "3", code: "KAR-MCR", name: "Kardia", active: true },
      { id: "4", code: "ANT-MCR", name: "Antoma", active: false },
      { id: "5", code: "BB-MCR", name: "Bombay Bird", active: false },
    ];
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("sites").select("id, code, name, active").order("name");
  return data ?? [];
}

export const roleCanApprove = (role: AppRole) => role === "admin" || role === "group_manager";

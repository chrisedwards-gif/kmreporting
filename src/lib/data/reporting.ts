import "server-only";

import { environment } from "@/lib/env";
import { demoReports, demoSites, demoWeek } from "@/lib/demo/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import type { AppRole, ManualPurchase, ReportDraftInput, ReportStatus, ReportingWeek, ReviewFlag, SitePerformance, WeeklyReport } from "@/lib/types";

export type ReportingBundle = {
  week: ReportingWeek;
  sites: SitePerformance[];
  reports: WeeklyReport[];
  expectedSiteCount: number;
  expectedSites: Array<{ id: string; name: string; code: string }>;
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

export async function getReportingBundle(periodId?: string, reportId?: string): Promise<ReportingBundle> {
  if (environment.isDemo) return { week: demoWeek, sites: demoSites, reports: demoReports, expectedSiteCount: demoSites.length, expectedSites: demoSites.map((site) => ({ id: site.id, name: site.name, code: site.code })) };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { week: getLatestCompletedReportingWeek(), sites: [], reports: [], expectedSiteCount: 0, expectedSites: [] };

  let targetPeriodId = periodId;
  if (reportId) {
    const { data: targetReport } = await supabase.from("weekly_reports").select("period_id").eq("id", reportId).maybeSingle();
    targetPeriodId = targetReport?.period_id;
  }
  let periodQuery = supabase.from("reporting_periods").select("id, week_start, week_end, due_at, reporting_cycle");
  periodQuery = targetPeriodId
    ? periodQuery.eq("id", targetPeriodId)
    : periodQuery.eq("reporting_cycle", "sunday_saturday").order("week_end", { ascending: false }).limit(1);
  const { data: period } = await periodQuery.maybeSingle();
  if (!period) {
    const fallbackWeek = getLatestCompletedReportingWeek();
    const { data: fallbackSites = [] } = await supabase.from("sites").select("id, name, code").lte("reporting_start_date", fallbackWeek.end).or(`reporting_end_date.is.null,reporting_end_date.gte.${fallbackWeek.start}`).order("name");
    return { week: fallbackWeek, sites: [], reports: [], expectedSiteCount: fallbackSites?.length ?? 0, expectedSites: fallbackSites ?? [] };
  }

  const { data: expectedSites = [] } = await supabase
    .from("sites")
    .select("id, name, code")
    .lte("reporting_start_date", period.week_end)
    .or(`reporting_end_date.is.null,reporting_end_date.gte.${period.week_start}`)
    .order("name");
  const expectedSiteCount = expectedSites?.length ?? 0;

  const { data: rawReports, error: reportError } = await supabase
    .from("weekly_reports")
    .select("id, site_id, manager_id, status, wins, operational_issues, staffing_issues, compliance_issues, equipment_issues, actions_underway, support_needed, submitted_at, updated_at")
    .eq("period_id", period.id);
  if (reportError) throw new Error("Unable to load weekly reports.");
  const reports = (rawReports ?? []) as DbReport[];
  const siteIds = [...new Set(reports.map((report) => report.site_id))];
  const managerIds = [...new Set(reports.map((report) => report.manager_id))];

  const [{ data: rawSites }, { data: rawProfiles }, { data: rawSnapshots }, { data: rawSources }, { data: rawManualPurchases }] = await Promise.all([
    siteIds.length
      ? supabase.from("sites").select("id, code, name, food_cost_target, labour_target, waste_target").in("id", siteIds)
      : Promise.resolve({ data: [] }),
    managerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", managerIds)
      : Promise.resolve({ data: [] }),
    supabase.from("site_cost_snapshots").select("report_id, site_id, net_sales, cogs, food_cost_pct, staff_cost, labour_pct, waste_cost, waste_pct, prime_cost, prime_cost_pct, food_cost_basis, review_flags").eq("period_id", period.id),
    reports.length
      ? supabase.from("report_source_values").select("report_id, sales_source, purchasing_source, labour_source, sales_source_reference, purchasing_source_reference, labour_source_reference, pending_credits, awaiting_invoice, stocktake_completed").in("report_id", reports.map((report) => report.id))
      : Promise.resolve({ data: [] }),
    reports.length
      ? supabase.from("report_manual_purchases").select("report_id, description, amount, receipt_reference").in("report_id", reports.map((report) => report.id)).order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const sitesById = new Map((rawSites ?? []).map((site) => [site.id, site]));
  const profilesById = new Map((rawProfiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const snapshotsByReport = new Map((rawSnapshots ?? []).map((snapshot) => [snapshot.report_id, snapshot]));
  const sourcesByReport = new Map((rawSources ?? []).map((source) => [source.report_id, source]));
  const manualPurchasesByReport = new Map<string, ManualPurchase[]>();
  for (const item of rawManualPurchases ?? []) {
    const current = manualPurchasesByReport.get(item.report_id) ?? [];
    current.push({ description: item.description, amount: Number(item.amount), receiptReference: item.receipt_reference ?? "" });
    manualPurchasesByReport.set(item.report_id, current);
  }

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
      foodCostBasis: snapshot?.food_cost_basis === "stock_adjusted" ? "stock_adjusted" : "spend",
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
  const weeklyReports: WeeklyReport[] = reports.map((report) => {
    const sources = sourcesByReport.get(report.id);
    return {
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
    manualPurchases: manualPurchasesByReport.get(report.id) ?? [],
    costs: performanceByReport.get(report.id)!,
    sources: sources ? {
      sales: sources.sales_source,
      purchasing: sources.purchasing_source,
      labour: sources.labour_source,
      salesReference: sources.sales_source_reference || undefined,
      purchasingReference: sources.purchasing_source_reference || undefined,
      labourReference: sources.labour_source_reference || undefined,
      pendingCredits: Number(sources.pending_credits ?? 0),
      awaitingInvoice: Number(sources.awaiting_invoice ?? 0),
      stocktakeCompleted: Boolean(sources.stocktake_completed),
    } : undefined,
  };
  }).filter((report) => Boolean(report.costs));

  return {
    week: { id: period.id, start: period.week_start, end: period.week_end, dueAt: period.due_at },
    sites: performance,
    reports: weeklyReports,
    expectedSiteCount: Math.max(expectedSiteCount ?? 0, new Set(reports.map((report) => report.site_id)).size),
    expectedSites: expectedSites ?? [],
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

export async function getReportingPeriods() {
  if (environment.isDemo) return [{ id: "demo", week_start: demoWeek.start, week_end: demoWeek.end }];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("reporting_periods")
    .select("id, week_start, week_end")
    .eq("reporting_cycle", "sunday_saturday")
    .order("week_end", { ascending: false })
    .limit(26);
  return data ?? [];
}

export async function getReportingWeek(periodId: string): Promise<ReportingWeek | null> {
  if (environment.isDemo) return periodId === "demo" ? demoWeek : null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(periodId)) return null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("reporting_periods")
    .select("id, week_start, week_end, due_at")
    .eq("id", periodId)
    .eq("reporting_cycle", "sunday_saturday")
    .maybeSingle();
  return data ? { id: data.id, start: data.week_start, end: data.week_end, dueAt: data.due_at } : null;
}

export async function getEditableDraft(reportId: string): Promise<ReportDraftInput | null> {
  if (environment.isDemo || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) return null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: report, error: reportError } = await supabase
    .from("weekly_reports")
    .select("id, site_id, period_id, status, wins, operational_issues, staffing_issues, compliance_issues, equipment_issues, actions_underway, support_needed")
    .eq("id", reportId)
    .eq("status", "draft")
    .maybeSingle();
  if (reportError || !report) return null;

  const [{ data: period }, { data: source }, { data: manualPurchaseRows }] = await Promise.all([
    supabase.from("reporting_periods").select("week_start, week_end").eq("id", report.period_id).maybeSingle(),
    supabase
      .from("report_source_values")
      .select("net_sales, opening_stock, purchases, credits, transfers_in, transfers_out, closing_stock, adjustments, waste_cost, stocktake_completed, staff_cost, paid_hours, pending_credits, awaiting_invoice, sales_source, purchasing_source, labour_source, sales_source_reference, purchasing_source_reference, labour_source_reference, sales_confirmed, purchasing_confirmed, labour_confirmed")
      .eq("report_id", report.id)
      .maybeSingle(),
    supabase.from("report_manual_purchases").select("description, amount, receipt_reference").eq("report_id", report.id).order("created_at"),
  ]);
  if (!period || !source) return null;
  const manualPurchases = (manualPurchaseRows ?? []).map((item) => ({ description: item.description, amount: Number(item.amount), receiptReference: item.receipt_reference ?? "" }));
  const manualPurchaseTotal = manualPurchases.reduce((total, item) => total + item.amount, 0);

  return {
    reportId: report.id,
    siteId: report.site_id,
    weekStart: period.week_start,
    weekEnd: period.week_end,
    stocktakeCompleted: Boolean(source.stocktake_completed),
    manualPurchases,
    values: {
      netSales: Number(source.net_sales ?? 0),
      openingStock: Number(source.opening_stock ?? 0),
      purchases: Math.max(Number(source.purchases ?? 0) - manualPurchaseTotal, 0),
      credits: Number(source.credits ?? 0),
      transfersIn: Number(source.transfers_in ?? 0),
      transfersOut: Number(source.transfers_out ?? 0),
      closingStock: Number(source.closing_stock ?? 0),
      adjustments: Number(source.adjustments ?? 0),
      wasteCost: Number(source.waste_cost ?? 0),
      staffCost: Number(source.staff_cost ?? 0),
      paidHours: Number(source.paid_hours ?? 0),
      pendingCredits: Number(source.pending_credits ?? 0),
      awaitingInvoice: Number(source.awaiting_invoice ?? 0),
    },
    sources: {
      sales: { mode: source.sales_source, reference: source.sales_source_reference ?? "", confirmed: Boolean(source.sales_confirmed) },
      purchasing: { mode: source.purchasing_source, reference: source.purchasing_source_reference ?? "", confirmed: Boolean(source.purchasing_confirmed) },
      labour: { mode: source.labour_source, reference: source.labour_source_reference ?? "", confirmed: Boolean(source.labour_confirmed) },
    },
    narrative: {
      wins: report.wins,
      operationalIssues: report.operational_issues,
      staffingIssues: report.staffing_issues,
      complianceIssues: report.compliance_issues,
      equipmentIssues: report.equipment_issues,
      actionsUnderway: report.actions_underway,
      supportNeeded: report.support_needed,
    },
  };
}

export async function getSiteDirectory() {
  if (environment.isDemo) {
    return [
      { id: "1", code: "DR-MCR", name: "Dough Religion", active: true, foodCostTarget: 30, labourTarget: 32, wasteTarget: 1.2, managers: [{ id: "m1", fullName: "Warren", email: "warren@example.test" }] },
      { id: "2", code: "CW-MCR", name: "Choi Wan", active: true, foodCostTarget: 31, labourTarget: 32, wasteTarget: 1.2, managers: [{ id: "m2", fullName: "Ricky", email: "ricky@example.test" }] },
      { id: "3", code: "KAR-MCR", name: "Kardia", active: true, foodCostTarget: 30.5, labourTarget: 33, wasteTarget: 1.2, managers: [] },
      { id: "4", code: "ANT-MCR", name: "Antoma", active: false, foodCostTarget: 30, labourTarget: 32, wasteTarget: 1.2, managers: [] },
      { id: "5", code: "BB-MCR", name: "Bombay Bird", active: false, foodCostTarget: 30, labourTarget: 32, wasteTarget: 1.2, managers: [] },
    ];
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("sites")
    .select("id, code, name, active, food_cost_target, labour_target, waste_target, site_memberships(user_id, can_submit, profiles(id, full_name, notification_email, role, active))")
    .order("name");
  return (data ?? []).map((site) => {
    const memberships = Array.isArray(site.site_memberships) ? site.site_memberships : [];
    const managers = memberships.flatMap((membership) => {
      const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles;
      if (!profile || profile.role !== "kitchen_manager" || !profile.active) return [];
      return [{ id: profile.id, fullName: profile.full_name, email: profile.notification_email ?? "" }];
    });
    return {
      id: site.id,
      code: site.code,
      name: site.name,
      active: site.active,
      foodCostTarget: Number(site.food_cost_target),
      labourTarget: Number(site.labour_target),
      wasteTarget: Number(site.waste_target),
      managers,
    };
  });
}

export const roleCanApprove = (role: AppRole) => role === "admin" || role === "group_manager";

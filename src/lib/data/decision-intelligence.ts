import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildDecisionSignals,
  type DailyLabourMetric,
  type DecisionSignal,
  type HourlySalesMetric,
  type ProductMetric,
  type ReconciliationMetric,
  type WeeklyMetric,
} from "@/lib/reporting/decision-engine";

export type DecisionIntelligence = {
  signals: DecisionSignal[];
  dataCoverage: {
    sites: number;
    reportWeeks: number;
    productRows: number;
    hourlySalesRows: number;
    labourDays: number;
    reconciliationRows: number;
  };
};

const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export async function getDecisionIntelligence(profile: SessionProfile): Promise<DecisionIntelligence> {
  if (environment.isDemo) return { signals: [], dataCoverage: { sites: 0, reportWeeks: 0, productRows: 0, hourlySalesRows: 0, labourDays: 0, reconciliationRows: 0 } };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { signals: [], dataCoverage: { sites: 0, reportWeeks: 0, productRows: 0, hourlySalesRows: 0, labourDays: 0, reconciliationRows: 0 } };

  let siteQuery = supabase
    .from("sites")
    .select("id, name, food_cost_target, labour_target, waste_target")
    .eq("organisation_id", profile.organisationId)
    .eq("active", true);
  if (profile.siteScopeIds) siteQuery = siteQuery.in("id", profile.siteScopeIds.length ? profile.siteScopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: sites = [] } = await siteQuery;
  const siteIds = (sites ?? []).map((site) => site.id);
  if (!siteIds.length) return { signals: [], dataCoverage: { sites: 0, reportWeeks: 0, productRows: 0, hourlySalesRows: 0, labourDays: 0, reconciliationRows: 0 } };
  const siteById = new Map((sites ?? []).map((site) => [site.id, site]));

  const { data: periods = [] } = await supabase
    .from("reporting_periods")
    .select("id, week_start")
    .eq("organisation_id", profile.organisationId)
    .eq("reporting_cycle", "sunday_saturday")
    .order("week_start", { ascending: false })
    .limit(10);
  const periodIds = (periods ?? []).map((period) => period.id);
  const periodById = new Map((periods ?? []).map((period) => [period.id, period.week_start]));

  const { data: reports = [] } = periodIds.length
    ? await supabase
      .from("weekly_reports")
      .select("id, site_id, period_id, status")
      .in("site_id", siteIds)
      .in("period_id", periodIds)
    : { data: [] };
  const reportIds = (reports ?? []).map((report) => report.id);
  const reportById = new Map((reports ?? []).map((report) => [report.id, report]));

  const [snapshotResult, productResult, hourlyResult, labourResult, reconciliationResult] = await Promise.all([
    reportIds.length
      ? supabase.from("site_cost_snapshots").select("report_id, site_id, net_sales, food_cost_pct, labour_pct, waste_pct").in("report_id", reportIds)
      : Promise.resolve({ data: [] }),
    reportIds.length
      ? supabase.from("report_sales_items").select("report_id, item_name, category, quantity, net_sales").in("report_id", reportIds).limit(4000)
      : Promise.resolve({ data: [] }),
    supabase.from("hourly_sales_metrics").select("site_id, business_date, slot_time, net_sales, transactions, covers").in("site_id", siteIds).gte("business_date", isoDaysAgo(70)).order("business_date"),
    supabase.from("rota_daily_labour_history").select("site_id, business_date, actual_hours, actual_hourly_cost, salary_cost_allocated").in("site_id", siteIds).gte("business_date", isoDaysAgo(70)).order("business_date"),
    supabase.from("weekly_reconciliations").select("site_id, metric_key, site_value, master_value, variance, variance_pct, status").in("site_id", siteIds).gte("week_start", isoDaysAgo(21)),
  ]);

  const weeklyMetrics: WeeklyMetric[] = (snapshotResult.data ?? []).flatMap((row) => {
    const report = reportById.get(row.report_id);
    const site = siteById.get(row.site_id);
    const weekStart = report ? periodById.get(report.period_id) : undefined;
    if (!report || !site || !weekStart) return [];
    return [{
      siteId: row.site_id,
      siteName: site.name,
      weekStart,
      netSales: Number(row.net_sales ?? 0),
      foodCostPct: row.food_cost_pct == null ? null : Number(row.food_cost_pct),
      labourPct: row.labour_pct == null ? null : Number(row.labour_pct),
      wastePct: row.waste_pct == null ? null : Number(row.waste_pct),
      foodCostTarget: Number(site.food_cost_target ?? 0),
      labourTarget: Number(site.labour_target ?? 0),
      wasteTarget: Number(site.waste_target ?? 0),
    }];
  });

  const productMetrics: ProductMetric[] = (productResult.data ?? []).flatMap((row) => {
    const report = reportById.get(row.report_id);
    if (!report) return [];
    const site = siteById.get(report.site_id);
    const weekStart = periodById.get(report.period_id);
    if (!site || !weekStart) return [];
    return [{
      siteId: report.site_id,
      siteName: site.name,
      weekStart,
      itemName: row.item_name,
      category: row.category,
      quantity: Number(row.quantity ?? 0),
      netSales: Number(row.net_sales ?? 0),
    }];
  });

  const hourlyMetrics: HourlySalesMetric[] = (hourlyResult.data ?? []).flatMap((row) => {
    const site = siteById.get(row.site_id);
    if (!site) return [];
    return [{
      siteId: row.site_id,
      siteName: site.name,
      businessDate: row.business_date,
      slotTime: row.slot_time,
      netSales: Number(row.net_sales ?? 0),
      transactions: Number(row.transactions ?? 0),
      covers: Number(row.covers ?? 0),
    }];
  });

  const labourMetrics: DailyLabourMetric[] = (labourResult.data ?? []).flatMap((row) => {
    const site = siteById.get(row.site_id);
    if (!site) return [];
    return [{
      siteId: row.site_id,
      siteName: site.name,
      businessDate: row.business_date,
      actualHours: Number(row.actual_hours ?? 0),
      actualHourlyCost: Number(row.actual_hourly_cost ?? 0),
      salaryCostAllocated: Number(row.salary_cost_allocated ?? 0),
    }];
  });

  const reconciliations: ReconciliationMetric[] = (reconciliationResult.data ?? []).flatMap((row) => {
    const site = siteById.get(row.site_id);
    if (!site) return [];
    return [{
      siteId: row.site_id,
      siteName: site.name,
      metricKey: row.metric_key,
      siteValue: row.site_value == null ? null : Number(row.site_value),
      masterValue: row.master_value == null ? null : Number(row.master_value),
      variance: row.variance == null ? null : Number(row.variance),
      variancePct: row.variance_pct == null ? null : Number(row.variance_pct),
      status: row.status as ReconciliationMetric["status"],
    }];
  });

  const signals = buildDecisionSignals({
    weeks: weeklyMetrics,
    products: productMetrics,
    hourlySales: hourlyMetrics,
    dailyLabour: labourMetrics,
    reconciliations,
  });

  return {
    signals,
    dataCoverage: {
      sites: siteIds.length,
      reportWeeks: new Set(weeklyMetrics.map((row) => `${row.siteId}:${row.weekStart}`)).size,
      productRows: productMetrics.length,
      hourlySalesRows: hourlyMetrics.length,
      labourDays: labourMetrics.length,
      reconciliationRows: reconciliations.length,
    },
  };
}

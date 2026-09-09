import "server-only";

import { createHash } from "node:crypto";
import type { SessionProfile } from "@/lib/auth/dal";
import { getDecisionIntelligence } from "@/lib/data/decision-intelligence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { DecisionSignal, HourlySalesMetric, ProductMetric } from "@/lib/reporting/decision-engine";
import { buildPowerhouseSignals, type HourlyLabourMetric, type MenuCostMetric, type SiteDecisionTarget } from "@/lib/reporting/powerhouse-engine";

export type PersistedDecisionSignal = DecisionSignal & {
  recordId: string | null;
  status: "open" | "accepted" | "dismissed" | "measuring" | "resolved";
};

export type PowerhouseIntelligence = {
  weekStart: string | null;
  signals: PersistedDecisionSignal[];
  dataCoverage: {
    sites: number;
    reportWeeks: number;
    productRows: number;
    hourlySalesRows: number;
    labourDays: number;
    reconciliationRows: number;
    menuCostRows: number;
    hourlyLabourRows: number;
  };
};

const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const sourceHash = (signal: DecisionSignal) => createHash("sha256").update(JSON.stringify({
  key: signal.key,
  title: signal.title,
  finding: signal.finding,
  recommendation: signal.recommendation,
  evidence: signal.evidence,
  confidence: signal.confidence,
  impact: signal.estimatedWeeklyImpact,
})).digest("hex");
const score = (signal: DecisionSignal) => {
  const severity = signal.severity === "risk" ? 40 : signal.severity === "opportunity" ? 32 : signal.severity === "watch" ? 20 : 8;
  const financial = signal.estimatedWeeklyImpact ? Math.min(Math.log10(Math.max(signal.estimatedWeeklyImpact, 1)) * 7, 22) : 0;
  return severity + signal.confidence * 0.35 + financial;
};

export async function getPowerhouseIntelligence(profile: SessionProfile): Promise<PowerhouseIntelligence> {
  const baseline = await getDecisionIntelligence(profile);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { weekStart: null, signals: baseline.signals.map((signal) => ({ ...signal, recordId: null, status: "open" })), dataCoverage: { ...baseline.dataCoverage, menuCostRows: 0, hourlyLabourRows: 0 } };

  let siteQuery = supabase.from("sites").select("id, name, food_cost_target").eq("organisation_id", profile.organisationId).eq("active", true);
  if (profile.siteScopeIds) siteQuery = siteQuery.in("id", profile.siteScopeIds.length ? profile.siteScopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: sites = [] } = await siteQuery;
  const siteIds = (sites ?? []).map((site) => site.id);
  if (!siteIds.length) return { weekStart: null, signals: [], dataCoverage: { ...baseline.dataCoverage, menuCostRows: 0, hourlyLabourRows: 0 } };

  const { data: periods = [] } = await supabase.from("reporting_periods").select("id, week_start").eq("organisation_id", profile.organisationId).eq("reporting_cycle", "sunday_saturday").order("week_start", { ascending: false }).limit(10);
  const weekStart = periods?.[0]?.week_start ?? null;
  const periodIds = (periods ?? []).map((period) => period.id);
  const periodById = new Map((periods ?? []).map((period) => [period.id, period.week_start]));
  const { data: reports = [] } = periodIds.length
    ? await supabase.from("weekly_reports").select("id, site_id, period_id").in("site_id", siteIds).in("period_id", periodIds)
    : { data: [] };
  const reportIds = (reports ?? []).map((report) => report.id);
  const reportById = new Map((reports ?? []).map((report) => [report.id, report]));
  const siteById = new Map((sites ?? []).map((site) => [site.id, site]));

  const [productsResult, costsResult, hourlySalesResult, hourlyLabourResult] = await Promise.all([
    reportIds.length
      ? supabase.from("report_sales_items").select("report_id, item_name, category, quantity, net_sales").in("report_id", reportIds).limit(6000)
      : Promise.resolve({ data: [] }),
    supabase.from("menu_item_costs").select("site_id, item_name, item_key, unit_food_cost, valid_from, valid_to").in("site_id", siteIds).lte("valid_from", new Date().toISOString().slice(0, 10)).order("valid_from"),
    supabase.from("hourly_sales_metrics").select("site_id, business_date, slot_time, net_sales, transactions, covers").in("site_id", siteIds).gte("business_date", isoDaysAgo(84)).order("business_date"),
    supabase.from("hourly_labour_metrics").select("site_id, business_date, slot_time, staffed_hours, staff_count, hourly_cost").in("site_id", siteIds).gte("business_date", isoDaysAgo(84)).order("business_date"),
  ]);

  const products: ProductMetric[] = (productsResult.data ?? []).flatMap((row) => {
    const report = reportById.get(row.report_id);
    const site = report ? siteById.get(report.site_id) : undefined;
    const period = report ? periodById.get(report.period_id) : undefined;
    if (!report || !site || !period) return [];
    return [{ siteId: report.site_id, siteName: site.name, weekStart: period, itemName: row.item_name, category: row.category, quantity: Number(row.quantity ?? 0), netSales: Number(row.net_sales ?? 0) }];
  });
  const menuCosts: MenuCostMetric[] = (costsResult.data ?? []).flatMap((row) => {
    const active = !row.valid_to || row.valid_to >= (weekStart ?? new Date().toISOString().slice(0, 10));
    if (!active) return [];
    return [{ siteId: row.site_id, itemName: row.item_name || row.item_key, unitFoodCost: Number(row.unit_food_cost ?? 0), validFrom: row.valid_from }];
  });
  const hourlySales: HourlySalesMetric[] = (hourlySalesResult.data ?? []).flatMap((row) => {
    const site = siteById.get(row.site_id);
    if (!site) return [];
    return [{ siteId: row.site_id, siteName: site.name, businessDate: row.business_date, slotTime: row.slot_time, netSales: Number(row.net_sales ?? 0), transactions: Number(row.transactions ?? 0), covers: Number(row.covers ?? 0) }];
  });
  const hourlyLabour: HourlyLabourMetric[] = (hourlyLabourResult.data ?? []).flatMap((row) => {
    const site = siteById.get(row.site_id);
    if (!site) return [];
    return [{ siteId: row.site_id, siteName: site.name, businessDate: row.business_date, slotTime: row.slot_time, staffedHours: Number(row.staffed_hours ?? 0), staffCount: Number(row.staff_count ?? 0), hourlyCost: Number(row.hourly_cost ?? 0) }];
  });
  const siteTargets: SiteDecisionTarget[] = (sites ?? []).map((site) => ({ siteId: site.id, siteName: site.name, foodCostTarget: Number(site.food_cost_target ?? 30) }));
  const advanced = buildPowerhouseSignals({ products, menuCosts, siteTargets, hourlySales, hourlyLabour });
  const merged = new Map<string, DecisionSignal>();
  for (const signal of [...baseline.signals, ...advanced]) {
    const key = `${signal.siteId}:${signal.key}`;
    const existing = merged.get(key);
    if (!existing || score(signal) > score(existing)) merged.set(key, signal);
  }
  const signals = [...merged.values()].sort((a, b) => score(b) - score(a)).slice(0, 40);

  if (!weekStart) return { weekStart: null, signals: signals.map((signal) => ({ ...signal, recordId: null, status: "open" })), dataCoverage: { ...baseline.dataCoverage, menuCostRows: menuCosts.length, hourlyLabourRows: hourlyLabour.length } };

  const admin = createAdminClient();
  const scope = profile.siteScopeIds === null ? "group" : "site";
  const rows = signals.map((signal) => ({
    organisation_id: profile.organisationId,
    week_start: weekStart,
    site_id: signal.siteId,
    scope,
    category: signal.category,
    signal_key: signal.key,
    severity: signal.severity,
    title: signal.title,
    finding: signal.finding,
    recommendation: signal.recommendation,
    evidence: signal.evidence,
    confidence: signal.confidence,
    estimated_weekly_impact: signal.estimatedWeeklyImpact,
    impact_direction: signal.impactDirection,
    source_hash: sourceHash(signal),
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) await admin.from("weekly_decision_signals").upsert(rows, { onConflict: "organisation_id,week_start,scope,site_id,signal_key,source_hash", ignoreDuplicates: false });
  const { data: persisted = [] } = await admin.from("weekly_decision_signals").select("id, site_id, signal_key, source_hash, status").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).eq("scope", scope).in("site_id", siteIds);
  const persistedByKey = new Map((persisted ?? []).map((row) => [`${row.site_id}:${row.signal_key}:${row.source_hash}`, row]));

  return {
    weekStart,
    signals: signals.map((signal) => {
      const hash = sourceHash(signal);
      const row = persistedByKey.get(`${signal.siteId}:${signal.key}:${hash}`);
      return { ...signal, recordId: row?.id ?? null, status: (row?.status ?? "open") as PersistedDecisionSignal["status"] };
    }),
    dataCoverage: { ...baseline.dataCoverage, menuCostRows: menuCosts.length, hourlyLabourRows: hourlyLabour.length },
  };
}

export const decisionItemKey = normalise;

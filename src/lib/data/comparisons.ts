import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ComparisonSite = { id: string; name: string; code: string; active: boolean };

export type ComparisonPeriodMetrics = {
  start: string;
  end: string;
  netSales: number;
  grossSales: number;
  transactions: number;
  covers: number;
  averageTransactionValue: number | null;
  foodCost: number;
  foodCostPct: number | null;
  staffCost: number;
  labourPct: number | null;
  wasteCost: number;
  wastePct: number | null;
  primeCost: number;
  primeCostPct: number | null;
  salesDays: number;
  reportWeeks: number;
};

export type ComparisonDailyPoint = {
  businessDate: string;
  netSales: number;
  grossSales: number;
  transactions: number;
  covers: number;
};

export type ReportingComparison = {
  siteId: string | null;
  rangeDays: number;
  metrics: {
    current: ComparisonPeriodMetrics;
    previous: ComparisonPeriodMetrics;
    prior_year: ComparisonPeriodMetrics;
  };
  daily: {
    current: ComparisonDailyPoint[];
    previous: ComparisonDailyPoint[];
    prior_year: ComparisonDailyPoint[];
  };
  availability: {
    firstDailyDate: string | null;
    lastDailyDate: string | null;
    totalSalesDays: number;
    firstWeekEnd: string | null;
    lastWeekEnd: string | null;
    totalReportWeeks: number;
  };
};

const emptyMetrics = (start: string, end: string): ComparisonPeriodMetrics => ({
  start,
  end,
  netSales: 0,
  grossSales: 0,
  transactions: 0,
  covers: 0,
  averageTransactionValue: null,
  foodCost: 0,
  foodCostPct: null,
  staffCost: 0,
  labourPct: null,
  wasteCost: 0,
  wastePct: null,
  primeCost: 0,
  primeCostPct: null,
  salesDays: 0,
  reportWeeks: 0,
});

export async function getComparisonSites(profile: SessionProfile): Promise<ComparisonSite[]> {
  if (environment.isDemo) {
    const sites = [
      { id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR", active: true },
      { id: "kardia", name: "Kardia", code: "KAR-MCR", active: true },
    ];
    return profile.siteScopeIds === null ? sites : sites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("sites").select("id, name, code, active").order("active", { ascending: false }).order("name");
  const sites = (data ?? []) as ComparisonSite[];
  return profile.siteScopeIds === null ? sites : sites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
}

export async function getReportingComparison(input: {
  profile: SessionProfile;
  siteId: string | null;
  start: string;
  end: string;
}): Promise<{ data: ReportingComparison; error: string | null }> {
  if (environment.isDemo) return { data: demoComparison(input.start, input.end, input.siteId), error: null };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { data: emptyComparison(input.start, input.end, input.siteId), error: "The reporting database is unavailable." };
  const { data, error } = await supabase.rpc("get_reporting_comparison", {
    target_site: input.siteId,
    range_start: input.start,
    range_end: input.end,
  });
  if (error || !data) {
    return {
      data: emptyComparison(input.start, input.end, input.siteId),
      error: error?.message.includes("get_reporting_comparison")
        ? "Historical comparisons are waiting for the latest database migration."
        : "Historical comparison data could not be loaded.",
    };
  }
  return { data: data as ReportingComparison, error: null };
}

function emptyComparison(start: string, end: string, siteId: string | null): ReportingComparison {
  return {
    siteId,
    rangeDays: Math.max(1, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1),
    metrics: {
      current: emptyMetrics(start, end),
      previous: emptyMetrics(start, end),
      prior_year: emptyMetrics(start, end),
    },
    daily: { current: [], previous: [], prior_year: [] },
    availability: { firstDailyDate: null, lastDailyDate: null, totalSalesDays: 0, firstWeekEnd: null, lastWeekEnd: null, totalReportWeeks: 0 },
  };
}

function demoComparison(start: string, end: string, siteId: string | null): ReportingComparison {
  const base = emptyComparison(start, end, siteId);
  const currentDaily = [620, 740, 810, 905, 1120, 1760, 1540].map((netSales, index) => ({
    businessDate: `2026-07-${String(index + 12).padStart(2, "0")}`,
    netSales,
    grossSales: netSales * 1.2,
    transactions: Math.round(netSales / 18),
    covers: Math.round(netSales / 21),
  }));
  const currentSales = currentDaily.reduce((sum, day) => sum + day.netSales, 0);
  return {
    ...base,
    metrics: {
      current: { ...base.metrics.current, netSales: currentSales, transactions: 417, covers: 356, averageTransactionValue: currentSales / 417, foodCost: 2180, foodCostPct: 29.1, staffCost: 2410, labourPct: 32.2, wasteCost: 84, wastePct: 1.1, primeCost: 4590, primeCostPct: 61.3, salesDays: 7, reportWeeks: 1 },
      previous: { ...base.metrics.previous, netSales: 7140, transactions: 404, covers: 345, averageTransactionValue: 17.67, foodCost: 2210, foodCostPct: 31, staffCost: 2350, labourPct: 32.9, wasteCost: 96, wastePct: 1.3, primeCost: 4560, primeCostPct: 63.9, salesDays: 7, reportWeeks: 1 },
      prior_year: base.metrics.prior_year,
    },
    daily: { ...base.daily, current: currentDaily },
    availability: { firstDailyDate: "2026-07-12", lastDailyDate: "2026-07-18", totalSalesDays: 7, firstWeekEnd: "2026-07-18", lastWeekEnd: "2026-07-18", totalReportWeeks: 1 },
  };
}

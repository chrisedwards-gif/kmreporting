import "server-only";

import { buildSalesInsights, type SalesInsights } from "@/lib/reporting/sales-insights";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SalesCategoryInput, SalesDayInput, SalesItemInput, WeeklyReport } from "@/lib/types";

type DayRow = { report_id: string; business_date: string; gross_sales: number | string; net_sales: number | string; transactions: number; covers: number };
type ItemRow = { report_id: string; item_name: string; category: string; quantity: number | string; net_sales: number | string };
type CategoryRow = { report_id: string; category: string; quantity: number | string; net_sales: number | string };

const mapDay = (row: DayRow): SalesDayInput => ({
  businessDate: row.business_date,
  grossSales: Number(row.gross_sales),
  netSales: Number(row.net_sales),
  transactions: Number(row.transactions),
  covers: Number(row.covers),
});

export async function getAdminSalesInsights({
  organisationId,
  reports,
  weekStart,
}: {
  organisationId: string;
  reports: WeeklyReport[];
  weekStart: string;
}): Promise<Record<string, SalesInsights>> {
  const admin = createAdminClient();
  const reportIds = reports.map((report) => report.id);
  if (!reportIds.length) return {};

  const previousStartDate = new Date(`${weekStart}T12:00:00Z`);
  previousStartDate.setUTCDate(previousStartDate.getUTCDate() - 7);
  const previousStart = previousStartDate.toISOString().slice(0, 10);

  const [{ data: currentDays }, { data: currentItems }, { data: currentCategories }, { data: previousPeriod }] = await Promise.all([
    admin.from("report_sales_days").select("report_id, business_date, gross_sales, net_sales, transactions, covers").in("report_id", reportIds).order("business_date"),
    admin.from("report_sales_items").select("report_id, item_name, category, quantity, net_sales").in("report_id", reportIds).order("net_sales", { ascending: false }),
    admin.from("report_sales_categories").select("report_id, category, quantity, net_sales").in("report_id", reportIds).order("net_sales", { ascending: false }),
    admin.from("reporting_periods").select("id").eq("organisation_id", organisationId).eq("week_start", previousStart).eq("reporting_cycle", "sunday_saturday").maybeSingle(),
  ]);

  const siteIds = [...new Set(reports.map((report) => report.siteId))];
  const { data: previousReports } = previousPeriod?.id && siteIds.length
    ? await admin.from("weekly_reports").select("id, site_id").eq("organisation_id", organisationId).eq("period_id", previousPeriod.id).in("site_id", siteIds)
    : { data: [] };
  const previousReportIds = (previousReports ?? []).map((report) => report.id);
  const { data: previousDays } = previousReportIds.length
    ? await admin.from("report_sales_days").select("report_id, business_date, gross_sales, net_sales, transactions, covers").in("report_id", previousReportIds).order("business_date")
    : { data: [] };

  const daysByReport = new Map<string, SalesDayInput[]>();
  const itemsByReport = new Map<string, SalesItemInput[]>();
  const categoriesByReport = new Map<string, SalesCategoryInput[]>();
  const previousDaysBySite = new Map<string, SalesDayInput[]>();
  const previousSiteByReport = new Map((previousReports ?? []).map((report) => [report.id, report.site_id]));

  for (const row of (currentDays ?? []) as DayRow[]) {
    const rows = daysByReport.get(row.report_id) ?? [];
    rows.push(mapDay(row));
    daysByReport.set(row.report_id, rows);
  }
  for (const row of (currentItems ?? []) as ItemRow[]) {
    const rows = itemsByReport.get(row.report_id) ?? [];
    rows.push({ itemName: row.item_name, category: row.category, quantity: Number(row.quantity), netSales: Number(row.net_sales) });
    itemsByReport.set(row.report_id, rows);
  }
  for (const row of (currentCategories ?? []) as CategoryRow[]) {
    const rows = categoriesByReport.get(row.report_id) ?? [];
    rows.push({ category: row.category, quantity: Number(row.quantity), netSales: Number(row.net_sales) });
    categoriesByReport.set(row.report_id, rows);
  }
  for (const row of (previousDays ?? []) as DayRow[]) {
    const siteId = previousSiteByReport.get(row.report_id);
    if (!siteId) continue;
    const rows = previousDaysBySite.get(siteId) ?? [];
    rows.push(mapDay(row));
    previousDaysBySite.set(siteId, rows);
  }

  return Object.fromEntries(reports.map((report) => [report.id, buildSalesInsights({
    days: daysByReport.get(report.id) ?? [],
    items: itemsByReport.get(report.id) ?? [],
    categories: categoriesByReport.get(report.id) ?? [],
    previousDays: previousDaysBySite.get(report.siteId) ?? [],
  })]));
}

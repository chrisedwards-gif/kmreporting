import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildSalesInsights, type SalesInsights } from "@/lib/reporting/sales-insights";
import type { SalesCategoryInput, SalesDayInput, SalesItemInput } from "@/lib/types";

const empty = () => buildSalesInsights({ days: [], items: [], categories: [] });

export async function getReportSalesInsights({
  reportId,
  siteId,
  weekStart,
}: {
  reportId: string;
  siteId: string;
  weekStart: string;
}): Promise<SalesInsights> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return empty();
  const previousStartDate = new Date(`${weekStart}T12:00:00Z`);
  previousStartDate.setUTCDate(previousStartDate.getUTCDate() - 7);
  const previousStart = previousStartDate.toISOString().slice(0, 10);

  const [{ data: dayRows, error: dayError }, { data: itemRows }, { data: categoryRows }, { data: previousPeriod }] = await Promise.all([
    supabase.from("report_sales_days").select("business_date, gross_sales, net_sales, transactions, covers").eq("report_id", reportId).order("business_date"),
    supabase.from("report_sales_items").select("item_name, category, quantity, net_sales").eq("report_id", reportId).order("net_sales", { ascending: false }).limit(100),
    supabase.from("report_sales_categories").select("category, quantity, net_sales").eq("report_id", reportId).order("net_sales", { ascending: false }).limit(50),
    supabase.from("reporting_periods").select("id").eq("week_start", previousStart).eq("reporting_cycle", "sunday_saturday").maybeSingle(),
  ]);
  if (dayError) return empty();

  let previousDays: SalesDayInput[] = [];
  if (previousPeriod?.id) {
    const { data: previousReport } = await supabase.from("weekly_reports").select("id").eq("site_id", siteId).eq("period_id", previousPeriod.id).maybeSingle();
    if (previousReport?.id) {
      const { data } = await supabase.from("report_sales_days").select("business_date, gross_sales, net_sales, transactions, covers").eq("report_id", previousReport.id).order("business_date");
      previousDays = mapDays(data ?? []);
    }
  }

  return buildSalesInsights({
    days: mapDays(dayRows ?? []),
    items: (itemRows ?? []).map((row): SalesItemInput => ({ itemName: row.item_name, category: row.category, quantity: Number(row.quantity), netSales: Number(row.net_sales) })),
    categories: (categoryRows ?? []).map((row): SalesCategoryInput => ({ category: row.category, quantity: Number(row.quantity), netSales: Number(row.net_sales) })),
    previousDays,
  });
}

function mapDays(rows: Array<{ business_date: string; gross_sales: number | string; net_sales: number | string; transactions: number; covers: number }>): SalesDayInput[] {
  return rows.map((row) => ({
    businessDate: row.business_date,
    grossSales: Number(row.gross_sales),
    netSales: Number(row.net_sales),
    transactions: Number(row.transactions),
    covers: Number(row.covers),
  }));
}

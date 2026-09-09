import { NextResponse, type NextRequest } from "next/server";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getDecisionIntelligence } from "@/lib/data/decision-intelligence";
import { getScopedReportingBundle } from "@/lib/data/scoped-reporting";
import { getReportSalesInsights } from "@/lib/data/sales-insights";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pct = (value: number) => `${value.toFixed(1)}%`;
const val = (value: number | null | undefined) => value == null ? "—" : formatCurrency(value);
const esc = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export async function GET(request: NextRequest) {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const requestedWeek = request.nextUrl.searchParams.get("week") ?? "";
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "The reporting database is unavailable." }, { status: 503 });

  let periodQuery = supabase.from("reporting_periods").select("id, week_start, week_end").eq("organisation_id", profile.organisationId).eq("reporting_cycle", "sunday_saturday");
  periodQuery = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)
    ? periodQuery.eq("week_start", requestedWeek)
    : periodQuery.order("week_end", { ascending: false }).limit(1);
  const { data: period } = await periodQuery.maybeSingle();
  if (!period) return NextResponse.json({ error: "No reporting week is available for the requested period." }, { status: 404 });

  const [bundle, intelligence, reconciliationResult, batchResult] = await Promise.all([
    getScopedReportingBundle(profile, period.id),
    getDecisionIntelligence(profile),
    supabase.from("weekly_reconciliations").select("site_id, metric_key, site_value, master_value, variance, variance_pct, status").eq("organisation_id", profile.organisationId).eq("week_start", period.week_start),
    supabase.from("weekly_upload_batches").select("id, site_id, batch_kind, status, created_at").eq("organisation_id", profile.organisationId).eq("week_start", period.week_start).order("created_at"),
  ]);
  const salesEntries = await Promise.all(bundle.reports.map(async (report) => [report.id, await getReportSalesInsights({ reportId: report.id, siteId: report.siteId, weekStart: report.weekStart })] as const));
  const salesByReport = new Map(salesEntries);
  const siteName = new Map(bundle.expectedSites.map((site) => [site.id, site.name]));
  const lines: string[] = [];

  lines.push(`# HOS Weekly Intelligence Review Pack`);
  lines.push(``);
  lines.push(`**Reporting week:** ${period.week_start} to ${period.week_end}`);
  lines.push(`**Prepared for:** Group Chef / HOS management`);
  lines.push(`**Purpose:** deterministic, source-traceable input for an AI-assisted management review. The AI must not invent missing data or override reconciliation warnings.`);
  lines.push(``);
  lines.push(`## How to review this pack`);
  lines.push(`Use the figures and evidence below as the source of truth. Separate confirmed facts from hypotheses. Prioritise decisions by expected financial/service impact, confidence and ease of action. Challenge recommendations where the evidence is weak. For every recommended change, state what should be measured next week to decide whether it worked.`);
  lines.push(``);

  const totalSales = bundle.sites.reduce((sum, site) => sum + site.netSales, 0);
  const totalCogs = bundle.sites.reduce((sum, site) => sum + site.cogs, 0);
  const totalLabour = bundle.sites.reduce((sum, site) => sum + site.staffCost, 0);
  const totalWaste = bundle.sites.reduce((sum, site) => sum + site.netSales * site.wastePct / 100, 0);
  lines.push(`## Group scorecard`);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Kitchens expected | ${bundle.expectedSiteCount} |`);
  lines.push(`| Kitchens reported | ${bundle.reports.length} |`);
  lines.push(`| Net sales | ${val(totalSales)} |`);
  lines.push(`| Food cost / spend | ${totalSales > 0 ? pct(totalCogs / totalSales * 100) : "—"} |`);
  lines.push(`| Labour | ${totalSales > 0 ? pct(totalLabour / totalSales * 100) : "—"} |`);
  lines.push(`| Waste | ${totalSales > 0 ? pct(totalWaste / totalSales * 100) : "—"} |`);
  lines.push(`| Prime cost | ${totalSales > 0 ? pct((totalCogs + totalLabour) / totalSales * 100) : "—"} |`);
  lines.push(``);

  lines.push(`## Kitchen performance`);
  lines.push(`| Kitchen | Sales | Food % | Labour % | Waste % | Prime % | Status |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---|`);
  for (const site of bundle.sites) {
    lines.push(`| ${esc(site.name)} | ${val(site.netSales)} | ${pct(site.foodCostPct)} | ${pct(site.labourPct)} | ${pct(site.wastePct)} | ${pct(site.primeCostPct)} | ${site.status} |`);
  }
  for (const expected of bundle.expectedSites.filter((site) => !bundle.reports.some((report) => report.siteId === site.id))) {
    lines.push(`| ${esc(expected.name)} | — | — | — | — | — | MISSING REPORT |`);
  }
  lines.push(``);

  const reconciliations = reconciliationResult.data ?? [];
  lines.push(`## Independent master cross-check`);
  const warnings = reconciliations.filter((row) => row.status !== "match");
  lines.push(warnings.length ? `**${warnings.length} reconciliation exception(s). Treat affected metrics as unconfirmed until resolved.**` : `All comparable site/master metrics currently match within tolerance.`);
  lines.push(``);
  if (reconciliations.length) {
    lines.push(`| Kitchen | Metric | Site | Master | Variance | Status |`);
    lines.push(`|---|---|---:|---:|---:|---|`);
    for (const row of reconciliations) {
      const money = row.metric_key !== "paid_hours";
      const fmt = (value: unknown) => value == null ? "—" : money ? val(Number(value)) : Number(value).toFixed(2);
      lines.push(`| ${esc(siteName.get(row.site_id) ?? "Kitchen")} | ${row.metric_key} | ${fmt(row.site_value)} | ${fmt(row.master_value)} | ${fmt(row.variance)} | ${row.status} |`);
    }
  }
  lines.push(``);

  lines.push(`## Ranked decision signals`);
  if (!intelligence.signals.length) lines.push(`No deterministic decision signal has met its evidence threshold yet.`);
  intelligence.signals.slice(0, 20).forEach((signal, index) => {
    lines.push(`### ${index + 1}. ${signal.siteName} — ${signal.title}`);
    lines.push(`- **Category:** ${signal.category}`);
    lines.push(`- **Severity:** ${signal.severity}`);
    lines.push(`- **Confidence:** ${signal.confidence}%`);
    lines.push(`- **Indicative weekly impact:** ${signal.estimatedWeeklyImpact == null ? "Not yet quantifiable" : `${val(signal.estimatedWeeklyImpact)} (${signal.impactDirection})`}`);
    lines.push(`- **Finding:** ${signal.finding}`);
    lines.push(`- **Recommendation:** ${signal.recommendation}`);
    lines.push(`- **Evidence:** ${signal.evidence.join("; ")}`);
    lines.push(``);
  });

  lines.push(`## Site commercial detail`);
  for (const report of bundle.reports) {
    const sales = salesByReport.get(report.id);
    lines.push(`### ${report.siteName}`);
    lines.push(`- Manager submission: ${report.manager}`);
    lines.push(`- Status: ${report.status}`);
    lines.push(`- Sales: ${val(report.costs.netSales)}`);
    lines.push(`- Food ${report.costs.foodCostBasis === "stock_adjusted" ? "cost" : "spend"}: ${pct(report.costs.foodCostPct)}`);
    lines.push(`- Labour: ${pct(report.costs.labourPct)}`);
    lines.push(`- Waste: ${pct(report.costs.wastePct)}`);
    lines.push(`- Manager wins: ${report.wins || "No commentary supplied"}`);
    lines.push(`- Operational issues: ${report.operationalIssues || "None supplied"}`);
    lines.push(`- Staffing issues: ${report.staffingIssues || "None supplied"}`);
    lines.push(`- Actions underway: ${report.actionsUnderway || "None supplied"}`);
    lines.push(`- Support needed: ${report.supportNeeded || "None supplied"}`);
    if (sales?.available) {
      lines.push(`- Transactions: ${sales.totalTransactions || "—"}`);
      lines.push(`- ATV: ${sales.atv == null ? "—" : val(sales.atv)}`);
      lines.push(`- Best day: ${sales.bestDay ? `${sales.bestDay.dayLabel} ${val(sales.bestDay.netSales)}` : "—"}`);
      lines.push(`- Weakest day: ${sales.weakestDay ? `${sales.weakestDay.dayLabel} ${val(sales.weakestDay.netSales)}` : "—"}`);
      lines.push(`- Week-on-week sales: ${sales.salesChangePct == null ? "—" : `${sales.salesChangePct > 0 ? "+" : ""}${sales.salesChangePct.toFixed(1)}%`}`);
      lines.push(`- Top products: ${sales.items.slice(0, 10).map((item) => `${item.itemName} (${item.quantity} / ${val(item.netSales)})`).join("; ") || "—"}`);
      lines.push(`- Category mix: ${sales.categories.slice(0, 8).map((category) => `${category.category} ${category.mixPct.toFixed(1)}%`).join("; ") || "—"}`);
      if (sales.days.length) lines.push(`- Daily sales: ${sales.days.map((day) => `${day.dayLabel} ${val(day.netSales)}${day.atv == null ? "" : ` ATV ${val(day.atv)}`}`).join("; ")}`);
    }
    lines.push(``);
  }

  lines.push(`## Data coverage`);
  lines.push(`- Report weeks available to decision engine: ${intelligence.dataCoverage.reportWeeks}`);
  lines.push(`- Product rows: ${intelligence.dataCoverage.productRows}`);
  lines.push(`- Hourly EPOS rows: ${intelligence.dataCoverage.hourlySalesRows}`);
  lines.push(`- Labour days: ${intelligence.dataCoverage.labourDays}`);
  lines.push(`- Reconciliation rows: ${intelligence.dataCoverage.reconciliationRows}`);
  lines.push(`- Weekly source batches this week: ${(batchResult.data ?? []).length}`);
  lines.push(``);
  lines.push(`## Required AI output`);
  lines.push(`Produce a concise Group Chef weekly report with: (1) the five highest-value decisions, (2) what changed and likely drivers, (3) menu/pricing actions, (4) labour/daypart actions, (5) purchasing/food-cost/waste actions, (6) data-quality exceptions, and (7) a next-week measurement plan. Do not recommend permanent menu or staffing changes from weak samples. Clearly label tests, hypotheses and confirmed findings.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`Generated by HOS Kitchen Reports deterministic intelligence layer. No generative AI was used to create this pack.`);

  const markdown = lines.join("\n");
  return new NextResponse(markdown, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="HOS-AI-Review-Pack-${period.week_end}.md"`,
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

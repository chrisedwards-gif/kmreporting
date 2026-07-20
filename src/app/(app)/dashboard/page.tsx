import Link from "next/link";
import { ArrowRight, CalendarDays, MessageSquareText } from "lucide-react";
import { CostChart } from "@/components/dashboard/cost-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SitePerformanceTable } from "@/components/dashboard/site-performance-table";
import { Workbench } from "@/components/dashboard/workbench";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getVisibleManagerMessages } from "@/lib/data/manager-home";
import { getReportingBundle } from "@/lib/data/reporting";
import { getWorkbench } from "@/lib/data/workbench";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Group overview" };

export default async function DashboardPage() {
  const [profile, rawBundle] = await Promise.all([requireSessionProfile(), getReportingBundle()]);
  const bundle = profile.previewSiteId ? {
    ...rawBundle,
    sites: rawBundle.sites.filter((site) => site.id === profile.previewSiteId),
    reports: rawBundle.reports.filter((report) => report.siteId === profile.previewSiteId),
    expectedSites: rawBundle.expectedSites.filter((site) => site.id === profile.previewSiteId),
    expectedSiteCount: rawBundle.expectedSites.some((site) => site.id === profile.previewSiteId) ? 1 : 0,
  } : rawBundle;
  const { sites, reports, week, expectedSiteCount } = bundle;
  const [workbench, messages] = await Promise.all([
    getWorkbench(profile.navigationRole, bundle, { siteId: profile.previewSiteId, managerId: profile.previewManagerId }),
    getVisibleManagerMessages(profile),
  ]);
  const totals = sites.reduce((sum, site) => ({ netSales: sum.netSales + site.netSales, cogs: sum.cogs + site.cogs, staffCost: sum.staffCost + site.staffCost, wasteCost: sum.wasteCost + (site.wastePct / 100) * site.netSales }), { netSales: 0, cogs: 0, staffCost: 0, wasteCost: 0 });
  const foodCostPct = totals.netSales ? (totals.cogs / totals.netSales) * 100 : 0;
  const labourPct = totals.netSales ? (totals.staffCost / totals.netSales) * 100 : 0;
  const wastePct = totals.netSales ? (totals.wasteCost / totals.netSales) * 100 : 0;
  const primeCostPct = totals.netSales ? ((totals.cogs + totals.staffCost) / totals.netSales) * 100 : 0;
  const reviewFlags = sites.flatMap((site) => site.flags.filter((flag) => flag.severity !== "info").map((flag) => ({ ...flag, siteName: site.name, reportId: reports.find((report) => report.siteId === site.id)?.id })));
  const allStockAdjusted = sites.length > 0 && sites.every((site) => site.foodCostBasis === "stock_adjusted");
  const weightedTarget = (selectTarget: (site: (typeof sites)[number]) => number) => totals.netSales ? sites.reduce((sum, site) => sum + selectTarget(site) * site.netSales, 0) / totals.netSales : 0;
  const foodTarget = weightedTarget((site) => site.foodCostTarget);
  const labourTarget = weightedTarget((site) => site.labourTarget);
  const wasteTarget = weightedTarget((site) => site.wasteTarget);
  const hasSales = totals.netSales > 0;
  const canCreateReport = profile.capabilities.editReports;
  const isManagerHome = profile.navigationRole === "kitchen_manager";
  const managerName = profile.isAccessPreview ? profile.previewManagerName : profile.fullName;
  const firstName = managerName?.trim().split(/\s+/)[0] ?? "there";
  const siteContext = sites.length === 1 ? sites[0]?.name : sites.length > 1 ? `${sites.length} kitchens` : "your kitchens";

  return (
    <>
      <header className="page-header page-header--personal">
        <div>
          <p className="page-header__eyebrow">{profile.isAccessPreview ? `${profile.previewSiteName} · Kitchen Manager view` : isManagerHome ? `${siteContext} · today` : "Weekly management summary"}</p>
          <h1 className="page-header__title">{isManagerHome ? `Hi, ${firstName}.` : "The group at a glance."}</h1>
          <p className="page-header__copy">{isManagerHome ? `Here’s what needs your attention today. Week ending ${formatDate(week.end)}.` : `Week ending ${formatDate(week.end)} · ${sites.length} of ${expectedSiteCount} active kitchens reported · ${reviewFlags.length} checks need attention.`}</p>
        </div>
        {canCreateReport ? <Link className="button button--primary" href="/reports/new">Start a report <ArrowRight aria-hidden="true" size={16} /></Link> : null}
      </header>

      {profile.isAccessPreview ? <div className="privacy-callout" style={{ marginBottom: "1rem" }}>You are seeing the same kitchen workspace and navigation as {profile.previewManagerName ?? "the assigned manager"}. Your Admin capabilities remain active so you can complete work with them.</div> : null}

      {isManagerHome ? <div className="section-kicker">Today’s actions</div> : null}
      <Workbench allClear={workbench.allClear} clearMessage={workbench.clearMessage} items={workbench.items} />

      {messages.length ? <section aria-label="Messages from management" className="manager-message-stack">{messages.map((message) => <article className={`manager-home-message manager-home-message--${message.priority}`} key={message.id}><MessageSquareText aria-hidden="true" size={18} /><div><div className="manager-home-message__meta">{message.siteName}{message.recipientProfileId ? ` · for ${message.recipientName}` : ""}</div><h2>{message.title}</h2><p>{message.body}</p></div></article>)}</section> : null}

      <section aria-label="Group metrics" className="metric-grid">
        <MetricCard accent="#2d7a62" label="Net sales" note={`Across ${sites.length} kitchen${sites.length === 1 ? "" : "s"}`} trend="up" value={formatCurrency(totals.netSales)} />
        <MetricCard accent="#eb6b4f" label={allStockAdjusted ? "Food cost" : "Food cost / spend"} note={`${formatCurrency(totals.cogs)} · target ≤ ${formatPercentage(foodTarget)}${allStockAdjusted ? "" : " · mixed basis"}`} overTarget={hasSales && foodCostPct > foodTarget} value={formatPercentage(foodCostPct)} />
        <MetricCard accent="#2d7a62" label="Staff cost" note={`${formatCurrency(totals.staffCost)} · target ≤ ${formatPercentage(labourTarget)}`} overTarget={hasSales && labourPct > labourTarget} value={formatPercentage(labourPct)} />
        <MetricCard accent="#c78324" label="Waste" note={`${formatCurrency(totals.wasteCost)} · target ≤ ${formatPercentage(wasteTarget)}`} overTarget={hasSales && wastePct > wasteTarget} value={formatPercentage(wastePct)} />
        <MetricCard accent="#1e2e35" label="Prime cost" note={formatCurrency(totals.cogs + totals.staffCost)} value={formatPercentage(primeCostPct)} />
        <MetricCard accent="#b93f35" label="Review queue" note="Approval blocks sharing" value={`${reviewFlags.length}`} />
      </section>

      <div className="dashboard-grid"><div className="stack"><section className="panel"><div className="panel__header"><div><h2 className="panel__title">Site performance</h2><p className="panel__subtitle">Safe, aggregated commercial metrics only</p></div><CalendarDays aria-hidden="true" color="#5f6e68" size={19} /></div><SitePerformanceTable sites={sites} /></section><section className="panel"><div className="panel__header"><div><h2 className="panel__title">Food cost / spend and labour</h2><p className="panel__subtitle">Percentage of net sales by kitchen; spend basis is shown until stocktakes begin</p></div></div><div className="panel__body"><CostChart sites={sites} /></div></section></div><aside className="panel"><div className="panel__header"><div><h2 className="panel__title">Manual review</h2><p className="panel__subtitle">Resolve before a report can be shared</p></div></div><div className="panel__body"><div className="review-list">{reviewFlags.map((flag, index) => <Link className={`review-item review-item--${flag.severity}`} href={flag.reportId ? `/reports/${flag.reportId}` : "/reports"} key={`${flag.code}-${index}`}><div className="review-item__site">{flag.siteName}</div><div className="review-item__label">{flag.label}</div><div className="review-item__detail">{flag.detail}</div></Link>)}{!reviewFlags.length ? <div className="empty-inline empty-inline--compact">No automated checks currently need management attention.</div> : null}</div></div></aside></div>
    </>
  );
}

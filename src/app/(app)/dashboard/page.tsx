import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { CostChart } from "@/components/dashboard/cost-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SitePerformanceTable } from "@/components/dashboard/site-performance-table";
import { getReportingBundle } from "@/lib/data/reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Group overview" };

export default async function DashboardPage() {
  const { sites, week, expectedSiteCount } = await getReportingBundle();
  const totals = sites.reduce(
    (sum, site) => ({
      netSales: sum.netSales + site.netSales,
      cogs: sum.cogs + site.cogs,
      staffCost: sum.staffCost + site.staffCost,
      wasteCost: sum.wasteCost + (site.wastePct / 100) * site.netSales,
    }),
    { netSales: 0, cogs: 0, staffCost: 0, wasteCost: 0 },
  );
  const foodCostPct = totals.netSales ? (totals.cogs / totals.netSales) * 100 : 0;
  const labourPct = totals.netSales ? (totals.staffCost / totals.netSales) * 100 : 0;
  const wastePct = totals.netSales ? (totals.wasteCost / totals.netSales) * 100 : 0;
  const primeCostPct = totals.netSales ? ((totals.cogs + totals.staffCost) / totals.netSales) * 100 : 0;
  const reviewFlags = sites.flatMap((site) =>
    site.flags.map((flag) => ({ ...flag, siteName: site.name, siteId: site.id })),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Weekly management summary</p>
          <h1 className="page-header__title">The group at a glance.</h1>
          <p className="page-header__copy">
            Week ending {formatDate(week.end)} · {sites.length} of {expectedSiteCount} active kitchens reported · {reviewFlags.length} checks need attention.
          </p>
        </div>
        <Link className="button button--primary" href="/reports/new">
          Start a report <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </header>

      <section aria-label="Group metrics" className="metric-grid">
        <MetricCard accent="#2d7a62" label="Net sales" note={`Across ${sites.length} kitchens`} trend="up" value={formatCurrency(totals.netSales)} />
        <MetricCard accent="#eb6b4f" label="COGS" note={formatCurrency(totals.cogs)} value={formatPercentage(foodCostPct)} />
        <MetricCard accent="#2d7a62" label="Staff cost" note={formatCurrency(totals.staffCost)} value={formatPercentage(labourPct)} />
        <MetricCard accent="#c78324" label="Waste" note={formatCurrency(totals.wasteCost)} value={formatPercentage(wastePct)} />
        <MetricCard accent="#1e2e35" label="Prime cost" note={formatCurrency(totals.cogs + totals.staffCost)} value={formatPercentage(primeCostPct)} />
        <MetricCard accent="#b93f35" label="Review queue" note="Approval blocks sharing" value={`${reviewFlags.length}`} />
      </section>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Site performance</h2>
                <p className="panel__subtitle">Safe, aggregated commercial metrics only</p>
              </div>
              <CalendarDays aria-hidden="true" color="#5f6e68" size={19} />
            </div>
            <SitePerformanceTable sites={sites} />
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Food and labour cost</h2>
                <p className="panel__subtitle">Percentage of net sales by kitchen</p>
              </div>
            </div>
            <div className="panel__body"><CostChart sites={sites} /></div>
          </section>
        </div>

        <aside className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Manual review</h2>
              <p className="panel__subtitle">Resolve before a report can be shared</p>
            </div>
          </div>
          <div className="panel__body">
            <div className="review-list">
              {reviewFlags.map((flag, index) => (
                <Link
                  className={`review-item review-item--${flag.severity}`}
                  href={`/reports/${flag.siteId}`}
                  key={`${flag.code}-${index}`}
                >
                  <div className="review-item__site">{flag.siteName}</div>
                  <div className="review-item__label">{flag.label}</div>
                  <div className="review-item__detail">{flag.detail}</div>
                </Link>
              ))}
              {!reviewFlags.length ? <div className="empty-inline empty-inline--compact">No automated checks currently need management attention.</div> : null}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { PeriodSelector } from "@/components/reports/period-selector";
import { getReportingBundle, getReportingPeriods } from "@/lib/data/reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Weekly reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const periods = await getReportingPeriods();
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const { reports } = await getReportingBundle(selectedPeriod);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">All kitchens</p>
          <h1 className="page-header__title">Weekly reports.</h1>
          <p className="page-header__copy">One submission per kitchen, rolled into one controlled group view.</p>
        </div>
        <div className="page-header__actions"><PeriodSelector periods={periods} selected={selectedPeriod} /><Link className="button button--primary" href={selectedPeriod ? `/reports/new?period=${selectedPeriod}` : "/reports/new"}><Plus aria-hidden="true" size={16} /> New report</Link></div>
      </header>
      <div className="report-list">
        {reports.map((report) => (
          <Link className="report-row" href={report.status === "draft" ? `/reports/new?report=${report.id}` : `/reports/${report.id}`} key={report.id}>
            <div className="site-cell">
              <div className="site-cell__mark">{report.costs.code.slice(0, 2)}</div>
              <div>
                <div className="site-cell__name">{report.siteName}</div>
                <div className="site-cell__manager">{report.manager} · Week ending {formatDate(report.weekEnd)}</div>
              </div>
            </div>
            <div><span className="report-row__metric-label">Sales</span>{formatCurrency(report.costs.netSales)}</div>
            <div><span className="report-row__metric-label">{report.costs.foodCostBasis === "stock_adjusted" ? "Food cost" : "Food spend"}</span>{formatPercentage(report.costs.foodCostPct)}</div>
            <div><span className="report-row__metric-label">Labour</span>{formatPercentage(report.costs.labourPct)}</div>
            <StatusBadge status={report.status} />
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        ))}
        {!reports.length ? <section className="panel empty-state"><h2>No reports for this week.</h2><p>Start the first kitchen report or select another reporting period.</p><Link className="button button--primary" href={selectedPeriod ? `/reports/new?period=${selectedPeriod}` : "/reports/new"}><Plus aria-hidden="true" size={16} /> Start a report</Link></section> : null}
      </div>
    </>
  );
}

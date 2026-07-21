import Link from "next/link";
import { ArrowRight, LineChart, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { PeriodSelector } from "@/components/reports/period-selector";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getReportingPeriods } from "@/lib/data/reporting";
import { getScopedReportingBundle } from "@/lib/data/scoped-reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Weekly reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const [{ period }, profile, periods] = await Promise.all([
    searchParams,
    requireSessionProfile(),
    getReportingPeriods(),
  ]);
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const bundle = await getScopedReportingBundle(profile, selectedPeriod);
  const reports = bundle.reports;
  const canCreateReport = profile.capabilities.editReports;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{profile.siteScopeIds ? `${profile.previewSiteName ?? (profile.siteScopeIds.length > 1 ? "Assigned kitchens" : "Your kitchen")} · scoped reporting` : "All kitchens"}</p>
          <h1 className="page-header__title">Weekly reports.</h1>
          <p className="page-header__copy">One submission per kitchen, rolled into one controlled group view.</p>
        </div>
        <div className="page-header__actions">
          <PeriodSelector periods={periods} selected={selectedPeriod} />
          <Link className="button button--secondary" href="/insights"><LineChart aria-hidden="true" size={16} /> Compare history</Link>
          {canCreateReport ? <Link className="button button--primary" href={selectedPeriod ? `/reports/new?period=${selectedPeriod}` : "/reports/new"}><Plus aria-hidden="true" size={16} /> New report</Link> : null}
        </div>
      </header>
      {profile.isAccessPreview ? <div className="privacy-callout" style={{ marginBottom: "1rem" }}>Admin site mode for {profile.previewSiteName}. Full reporting controls are retained; only this kitchen’s reports are loaded.</div> : null}
      <div className="report-list">
        {reports.map((report) => {
          const canContinueDraft = report.status === "draft" && canCreateReport;
          return (
            <Link className="report-row" href={canContinueDraft ? `/reports/new?report=${report.id}` : `/reports/${report.id}`} key={report.id}>
              <div className="site-cell">
                <div className="site-cell__mark">{report.costs.code.slice(0, 2)}</div>
                <div><div className="site-cell__name">{report.siteName}</div><div className="site-cell__manager">{report.manager} · Week ending {formatDate(report.weekEnd)}</div></div>
              </div>
              <div><span className="report-row__metric-label">Sales</span>{formatCurrency(report.costs.netSales)}</div>
              <div><span className="report-row__metric-label">{report.costs.foodCostBasis === "stock_adjusted" ? "Food cost" : "Food spend"}</span>{formatPercentage(report.costs.foodCostPct)}</div>
              <div><span className="report-row__metric-label">Labour</span>{formatPercentage(report.costs.labourPct)}</div>
              <StatusBadge status={report.status} />
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          );
        })}
        {!reports.length ? <section className="panel empty-state"><h2>No reports for this week.</h2><p>{canCreateReport ? "Start the first report for a kitchen in your current scope or select another reporting period." : "Select another reporting period to view historical reports."}</p>{canCreateReport ? <Link className="button button--primary" href={selectedPeriod ? `/reports/new?period=${selectedPeriod}` : "/reports/new"}><Plus aria-hidden="true" size={16} /> Start a report</Link> : null}</section> : null}
      </div>
    </>
  );
}

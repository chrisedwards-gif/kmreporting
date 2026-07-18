import Link from "next/link";
import { CheckCircle2, LockKeyhole, ShieldAlert } from "lucide-react";
import { SummaryControls } from "@/components/reports/summary-controls";
import { PeriodSelector } from "@/components/reports/period-selector";
import { StatusBadge } from "@/components/ui/status-badge";
import { getReportingBundle, getReportingPeriods } from "@/lib/data/reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";
import { requireRole } from "@/lib/auth/dal";

export const metadata = { title: "Management summary" };

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "finance", "viewer"]);
  const { period } = await searchParams;
  const periods = await getReportingPeriods();
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const { reports, sites, week, expectedSiteCount } = await getReportingBundle(selectedPeriod);
  const missingReports = Math.max(expectedSiteCount - reports.length, 0);
  const ready = reports.length > 0 && missingReports === 0 && reports.every((report) => ["approved", "shared"].includes(report.status));
  const released = ready && reports.every((report) => report.status === "shared");
  const totals = sites.reduce((sum, site) => ({ sales: sum.sales + site.netSales, cogs: sum.cogs + site.cogs, labour: sum.labour + site.staffCost }), { sales: 0, cogs: 0, labour: 0 });
  const foodPct = totals.sales ? totals.cogs / totals.sales * 100 : 0;
  const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;

  return (
    <div className="management-summary">
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Consistent group output</p>
          <h1 className="page-header__title">Management summary.</h1>
          <p className="page-header__copy">Week ending {formatDate(week.end)} · Generated from the current approved site records.</p>
        </div>
        <div className="page-header__actions"><PeriodSelector basePath="/summary" periods={periods} selected={selectedPeriod} /><SummaryControls canRelease={["admin", "group_manager"].includes(profile.role)} periodId={selectedPeriod} ready={ready} released={released} /></div>
      </header>

      {!ready && (
        <div className="privacy-callout" style={{ marginBottom: "1rem" }}>
          <LockKeyhole aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />
          Sharing is locked. Every active kitchen needs a report and named approval before this summary can be released.{missingReports ? ` ${missingReports} active kitchen report${missingReports === 1 ? " is" : "s are"} still missing.` : ""}
        </div>
      )}

      <section className="panel">
        <div className="panel__header">
          <div><h2 className="panel__title">House of Social · Kitchen performance</h2><p className="panel__subtitle">Monday {formatDate(week.start)} to Sunday {formatDate(week.end)}</p></div>
          <span className={`status-badge status-badge--${released ? "shared" : ready ? "approved" : "review_required"}`}>{released ? "Released" : ready ? "Approved to release" : "Internal draft"}</span>
        </div>
        <div className="panel__body">
          <section aria-label="Summary metrics" className="metric-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <article className="metric-card"><div className="metric-card__label">Net sales</div><div className="metric-card__value">{formatCurrency(totals.sales)}</div></article>
            <article className="metric-card"><div className="metric-card__label">Food cost</div><div className="metric-card__value">{formatPercentage(foodPct)}</div><div className="metric-card__note">{formatCurrency(totals.cogs)}</div></article>
            <article className="metric-card"><div className="metric-card__label">Staff cost</div><div className="metric-card__value">{formatPercentage(labourPct)}</div><div className="metric-card__note">{formatCurrency(totals.labour)}</div></article>
            <article className="metric-card"><div className="metric-card__label">Prime cost</div><div className="metric-card__value">{formatPercentage(foodPct + labourPct)}</div><div className="metric-card__note">{formatCurrency(totals.cogs + totals.labour)}</div></article>
          </section>

          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "1.45rem", fontWeight: 500, margin: "1.5rem 0 1rem" }}>Kitchen updates</h2>
          <div className="stack">
            {reports.map((report) => (
              <article className="review-item review-item--info" key={report.id}>
                <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <div><div className="review-item__site">{report.costs.code}</div><div className="review-item__label">{report.siteName}</div></div>
                  <StatusBadge status={report.status} />
                </div>
                <div className="review-item__detail" style={{ marginTop: ".75rem" }}>
                  <strong>Performance:</strong> {formatCurrency(report.costs.netSales)} net sales · {formatPercentage(report.costs.foodCostPct)} food · {formatPercentage(report.costs.labourPct)} labour.
                </div>
                <div className="review-item__detail"><strong>Win:</strong> {report.wins || "No material win recorded."}</div>
                <div className="review-item__detail"><strong>Attention:</strong> {report.operationalIssues || report.staffingIssues || report.complianceIssues || "No material issue recorded."}</div>
                <div className="review-item__detail"><strong>Action:</strong> {report.actionsUnderway || "No follow-up action recorded."}</div>
                {report.supportNeeded && <div className="review-item__detail"><strong>Group support:</strong> {report.supportNeeded}</div>}
                {!['approved', 'shared'].includes(report.status) && <Link href={`/reports/${report.id}`} style={{ alignItems: "center", display: "inline-flex", fontSize: ".72rem", fontWeight: 800, gap: ".3rem", marginTop: ".7rem" }}><ShieldAlert aria-hidden="true" size={14} /> Resolve approval</Link>}
              </article>
            ))}
            {!reports.length ? <div className="empty-inline empty-inline--compact">No kitchen reports have been submitted for this reporting period.</div> : null}
          </div>

          <div className="privacy-callout" style={{ marginTop: "1.5rem" }}>
            <CheckCircle2 aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />
            This summary contains site-level totals only. Individual salaries, hourly rates and employee time entries are excluded by design.
          </div>
        </div>
      </section>
    </div>
  );
}

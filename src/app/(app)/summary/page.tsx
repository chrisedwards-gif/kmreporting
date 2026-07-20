import { CheckCircle2, LockKeyhole } from "lucide-react";
import { PeriodSelector } from "@/components/reports/period-selector";
import { SummaryControls } from "@/components/reports/summary-controls";
import { SummaryEmailTest } from "@/components/reports/summary-email-test";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { getReportingBundle, getReportingPeriods } from "@/lib/data/reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Management summary" };

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "finance", "viewer"]);
  const { period } = await searchParams;
  const periods = await getReportingPeriods();
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const { reports, sites, week, expectedSites } = await getReportingBundle(selectedPeriod);
  const reportBySite = new Map(reports.map((report) => [report.siteId, report]));
  const approvedReports = reports.filter((report) => ["approved", "shared"].includes(report.status));
  const approvedReportIds = new Set(approvedReports.map((report) => report.id));
  const approvedSites = sites.filter((site) => Boolean(site.reportId) && approvedReportIds.has(site.reportId as string));
  const missingReports = expectedSites.filter((site) => !reportBySite.has(site.id)).length;
  const ready = expectedSites.length > 0 && expectedSites.every((site) => ["approved", "shared"].includes(reportBySite.get(site.id)?.status ?? "draft"));
  const released = ready && expectedSites.every((site) => reportBySite.get(site.id)?.status === "shared");
  const hasApprovedReports = approvedReports.length > 0;
  const outstandingSiteNames = expectedSites
    .filter((site) => !["approved", "shared"].includes(reportBySite.get(site.id)?.status ?? "draft"))
    .map((site) => site.name);
  const totals = approvedSites.reduce(
    (sum, site) => ({ sales: sum.sales + site.netSales, cogs: sum.cogs + site.cogs, labour: sum.labour + site.staffCost }),
    { sales: 0, cogs: 0, labour: 0 },
  );
  const foodPct = totals.sales ? totals.cogs / totals.sales * 100 : 0;
  const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;
  const allStockAdjusted = approvedSites.length > 0 && approvedSites.every((site) => site.foodCostBasis === "stock_adjusted");

  return (
    <div className={`management-summary ${released ? "management-summary--released" : "management-summary--partial"}`}>
      {!ready && <div className="print-partial-message">PARTIAL MANAGEMENT UPDATE — awaiting remaining kitchen reports or named approvals. Figures shown include approved kitchen reports only.</div>}
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Consistent group output</p>
          <h1 className="page-header__title">Management summary.</h1>
          <p className="page-header__copy">Week ending {formatDate(week.end)} · Generated only from approved kitchen records.</p>
        </div>
        <div className="page-header__actions"><PeriodSelector basePath="/summary" periods={periods} selected={selectedPeriod} /><SummaryEmailTest enabled={profile.capabilities.manageGroup && hasApprovedReports} periodId={selectedPeriod} /><SummaryControls canRelease={profile.capabilities.approveReports} hasApprovedReports={hasApprovedReports} periodId={selectedPeriod} ready={ready} released={released} /></div>
      </header>

      {profile.capabilities.manageGroup ? <div className="privacy-callout" style={{ marginBottom: "1rem" }}>Email testing currently sends only to your own notification address. Jake does not yet have a production reporting account; add him through Administration → People & access after the format is approved.</div> : null}

      {!ready && (
        <div className="privacy-callout" style={{ marginBottom: "1rem" }}>
          <LockKeyhole aria-hidden="true" className="privacy-callout__icon" size={15} />
          Complete group release is still locked. You can share an approved kitchen individually, or record and print a clearly labelled partial update. {missingReports ? `${missingReports} kitchen report${missingReports === 1 ? " is" : "s are"} still missing.` : "Some submitted kitchen reports are still awaiting named approval."}
          {outstandingSiteNames.length ? ` Outstanding: ${outstandingSiteNames.join(", ")}.` : ""}
        </div>
      )}

      <section className="panel">
        <div className="panel__header">
          <div><h2 className="panel__title">House of Social · Kitchen performance</h2><p className="panel__subtitle">Sunday {formatDate(week.start)} to Saturday {formatDate(week.end)} · {approvedReports.length} of {expectedSites.length} approved</p></div>
          <span className={`status-badge status-badge--${released ? "shared" : ready ? "approved" : "review_required"}`}>{released ? "Released" : ready ? "Approved to release" : "Internal partial"}</span>
        </div>
        <div className="panel__body">
          <section aria-label="Summary metrics" className="metric-grid metric-grid--four">
            <article className="metric-card"><div className="metric-card__label">Approved net sales</div><div className="metric-card__value">{formatCurrency(totals.sales)}</div></article>
            <article className="metric-card"><div className="metric-card__label">{allStockAdjusted ? "Food cost" : "Food cost / spend"}</div><div className="metric-card__value">{formatPercentage(foodPct)}</div><div className="metric-card__note">{formatCurrency(totals.cogs)}{approvedSites.length && !allStockAdjusted ? " · includes spend-basis sites" : ""}</div></article>
            <article className="metric-card"><div className="metric-card__label">Staff cost</div><div className="metric-card__value">{formatPercentage(labourPct)}</div><div className="metric-card__note">{formatCurrency(totals.labour)}</div></article>
            <article className="metric-card"><div className="metric-card__label">Prime cost</div><div className="metric-card__value">{formatPercentage(foodPct + labourPct)}</div><div className="metric-card__note">{formatCurrency(totals.cogs + totals.labour)}</div></article>
          </section>

          <h2 className="summary-section-title">Approved kitchen updates</h2>
          <div className="stack">
            {approvedReports.map((report) => (
              <article className="review-item review-item--info" key={report.id}>
                <div className="approval-card__top">
                  <div><div className="review-item__site">{report.costs.code}</div><div className="review-item__label">{report.siteName}</div></div>
                  <StatusBadge status={report.status} />
                </div>
                <div className="review-item__detail" style={{ marginTop: ".75rem" }}>
                  <strong>Performance:</strong> {formatCurrency(report.costs.netSales)} net sales · {formatPercentage(report.costs.foodCostPct)} {report.costs.foodCostBasis === "stock_adjusted" ? "food cost" : "food spend"} · {formatPercentage(report.costs.labourPct)} labour.
                </div>
                <div className="review-item__detail"><strong>Win:</strong> {report.wins || "No material win recorded."}</div>
                <div className="review-item__detail"><strong>Attention:</strong> {report.operationalIssues || report.staffingIssues || report.complianceIssues || "No material issue recorded."}</div>
                <div className="review-item__detail"><strong>Action:</strong> {report.actionsUnderway || "No follow-up action recorded."}</div>
                {report.supportNeeded && <div className="review-item__detail"><strong>Group support:</strong> {report.supportNeeded}</div>}
              </article>
            ))}
            {!approvedReports.length ? <div className="empty-inline empty-inline--compact">No kitchen report has received named approval for this period yet.</div> : null}
          </div>

          <div className="privacy-callout" style={{ marginTop: "1.5rem" }}>
            <CheckCircle2 aria-hidden="true" className="privacy-callout__icon" size={15} />
            This summary contains approved site-level totals only. Individual salaries, hourly rates and employee time entries are excluded by design.
          </div>
        </div>
      </section>
    </div>
  );
}

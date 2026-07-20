import { AlertTriangle, CheckCircle2, LockKeyhole } from "lucide-react";
import { PeriodSelector } from "@/components/reports/period-selector";
import { SummaryControls } from "@/components/reports/summary-controls";
import { SummaryEmailTest } from "@/components/reports/summary-email-test";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getReportingPeriods } from "@/lib/data/reporting";
import { getScopedReportingBundle } from "@/lib/data/scoped-reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Management summary" };

const percentagePointVariance = (actual: number, target: number) => {
  const variance = actual - target;
  return `${variance > 0 ? "+" : ""}${variance.toFixed(1)}pp vs target`;
};

const narrativeOrFallback = (value: string, fallback: string) => value.trim() || fallback;

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager", "finance", "viewer"]);
  const { period } = await searchParams;
  const periods = await getReportingPeriods();
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const { reports, week, expectedSites } = await getScopedReportingBundle(profile, selectedPeriod);
  const reportBySite = new Map(reports.map((report) => [report.siteId, report]));
  const approvedReports = reports
    .filter((report) => ["approved", "shared"].includes(report.status))
    .sort((left, right) => left.siteName.localeCompare(right.siteName));
  const missingReports = expectedSites.filter((site) => !reportBySite.has(site.id));
  const awaitingApproval = expectedSites.filter((site) => {
    const report = reportBySite.get(site.id);
    return report && !["approved", "shared"].includes(report.status);
  });
  const ready = expectedSites.length > 0 && expectedSites.every((site) => ["approved", "shared"].includes(reportBySite.get(site.id)?.status ?? "draft"));
  const released = ready && expectedSites.every((site) => reportBySite.get(site.id)?.status === "shared");
  const hasApprovedReports = approvedReports.length > 0;
  const totals = approvedReports.reduce(
    (sum, report) => {
      const manualPurchases = (report.manualPurchases ?? []).reduce((total, item) => total + item.amount, 0);
      return {
        sales: sum.sales + report.costs.netSales,
        food: sum.food + report.costs.cogs,
        labour: sum.labour + report.costs.staffCost,
        waste: sum.waste + (report.costs.netSales * report.costs.wastePct / 100),
        pendingCredits: sum.pendingCredits + (report.sources?.pendingCredits ?? 0),
        awaitingInvoice: sum.awaitingInvoice + (report.sources?.awaitingInvoice ?? 0),
        manualPurchases: sum.manualPurchases + manualPurchases,
      };
    },
    { sales: 0, food: 0, labour: 0, waste: 0, pendingCredits: 0, awaitingInvoice: 0, manualPurchases: 0 },
  );
  const foodPct = totals.sales ? totals.food / totals.sales * 100 : 0;
  const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;
  const wastePct = totals.sales ? totals.waste / totals.sales * 100 : 0;
  const primeCost = totals.food + totals.labour;
  const primeCostPct = totals.sales ? primeCost / totals.sales * 100 : 0;
  const weightedTarget = (selectTarget: (report: (typeof approvedReports)[number]) => number) => totals.sales
    ? approvedReports.reduce((sum, report) => sum + selectTarget(report) * report.costs.netSales, 0) / totals.sales
    : 0;
  const foodTarget = weightedTarget((report) => report.costs.foodCostTarget);
  const labourTarget = weightedTarget((report) => report.costs.labourTarget);
  const wasteTarget = weightedTarget((report) => report.costs.wasteTarget);
  const allStockAdjusted = approvedReports.length > 0 && approvedReports.every((report) => report.costs.foodCostBasis === "stock_adjusted");
  const actionableFlagCount = approvedReports.reduce((count, report) => count + report.costs.flags.filter((flag) => flag.severity !== "info").length, 0);
  const releaseLabel = released ? "Released weekly management pack" : ready ? "Approved and ready to release" : "Internal partial management pack";
  const releaseDetail = released
    ? `Released with ${approvedReports.length} of ${expectedSites.length} active reporting kitchens.`
    : ready
      ? "Every active reporting kitchen has named approval. The pack can now be released."
      : `${approvedReports.length} of ${expectedSites.length} active reporting kitchens are approved and included.`;
  const wins = approvedReports.filter((report) => report.wins.trim()).map((report) => ({ site: report.siteName, text: report.wins }));
  const risks = approvedReports.flatMap((report) => [
    { site: report.siteName, label: "Operational", text: report.operationalIssues },
    { site: report.siteName, label: "Staffing", text: report.staffingIssues },
    { site: report.siteName, label: "Compliance", text: report.complianceIssues },
    { site: report.siteName, label: "Equipment", text: report.equipmentIssues },
  ].filter((item) => item.text.trim()));
  const groupActions = approvedReports.filter((report) => report.actionsUnderway.trim()).map((report) => ({ site: report.siteName, text: report.actionsUnderway }));
  const supportRequests = approvedReports.filter((report) => report.supportNeeded.trim()).map((report) => ({ site: report.siteName, text: report.supportNeeded }));

  return (
    <div className={`management-summary management-pack ${released ? "management-summary--released" : "management-summary--partial"}`}>
      {!ready ? <div className="print-partial-message">INTERNAL PARTIAL MANAGEMENT PACK - approved kitchen reports only. Outstanding kitchens and approvals are listed in reporting coverage.</div> : null}

      <section className={`summary-release-state summary-release-state--${released ? "released" : ready ? "ready" : "pending"}`} aria-label="Weekly pack release status">
        <div><span>Week ending {formatDate(week.end)}</span><strong>{releaseLabel}</strong><small>{releaseDetail}</small></div>
        <StatusBadge status={released ? "shared" : ready ? "approved" : "review_required"} />
      </section>

      <header className="page-header management-pack__header">
        <div>
          <p className="page-header__eyebrow">House of Social · weekly management report</p>
          <h1 className="page-header__title">Kitchen performance pack.</h1>
          <p className="page-header__copy">Sunday {formatDate(week.start)} to Saturday {formatDate(week.end)} · group overview followed by a full report for each approved kitchen.</p>
        </div>
        <div className="page-header__actions">
          <PeriodSelector basePath="/summary" periods={periods} selected={selectedPeriod} />
          <SummaryEmailTest enabled={profile.capabilities.manageGroup && hasApprovedReports} periodId={selectedPeriod} />
          <SummaryControls canRelease={profile.capabilities.approveReports} hasApprovedReports={hasApprovedReports} periodId={selectedPeriod} ready={ready} released={released} weekEnd={week.end} />
        </div>
      </header>

      {!ready ? (
        <div className="privacy-callout management-pack__screen-note">
          <LockKeyhole aria-hidden="true" className="privacy-callout__icon" size={15} />
          This export will be clearly marked as partial. {missingReports.length ? `${missingReports.map((site) => site.name).join(", ")} ${missingReports.length === 1 ? "has" : "have"} not submitted.` : "All active kitchens have submitted."} {awaitingApproval.length ? `${awaitingApproval.map((site) => site.name).join(", ")} ${awaitingApproval.length === 1 ? "is" : "are"} awaiting approval.` : ""}
        </div>
      ) : null}

      <section className="panel management-summary__pack management-pack__group-overview">
        <div className="panel__header">
          <div><h2 className="panel__title">Group overview</h2><p className="panel__subtitle">Approved kitchen totals · weighted percentages against net sales</p></div>
          <span className={`status-badge status-badge--${released ? "shared" : ready ? "approved" : "review_required"}`}>{approvedReports.length} of {expectedSites.length} included</span>
        </div>
        <div className="panel__body stack">
          <section aria-label="Group commercial metrics" className="management-pack__metric-grid">
            <article className="management-pack__metric"><span>Net sales</span><strong>{formatCurrency(totals.sales)}</strong><small>{approvedReports.length} approved kitchen{approvedReports.length === 1 ? "" : "s"}</small></article>
            <article className="management-pack__metric"><span>{allStockAdjusted ? "Food cost" : "Food cost / spend"}</span><strong>{formatPercentage(foodPct)}</strong><small>{formatCurrency(totals.food)} · target {formatPercentage(foodTarget)}</small></article>
            <article className="management-pack__metric"><span>Labour</span><strong>{formatPercentage(labourPct)}</strong><small>{formatCurrency(totals.labour)} · target {formatPercentage(labourTarget)}</small></article>
            <article className="management-pack__metric"><span>Waste</span><strong>{formatPercentage(wastePct)}</strong><small>{formatCurrency(totals.waste)} · target {formatPercentage(wasteTarget)}</small></article>
            <article className="management-pack__metric"><span>Prime cost</span><strong>{formatPercentage(primeCostPct)}</strong><small>{formatCurrency(primeCost)}</small></article>
            <article className="management-pack__metric"><span>Controls outstanding</span><strong>{actionableFlagCount}</strong><small>{formatCurrency(totals.pendingCredits)} pending credits · {formatCurrency(totals.awaitingInvoice)} awaiting invoice</small></article>
          </section>

          <section className="management-pack__section">
            <div className="management-pack__section-heading"><div><span>Reporting coverage</span><h2>Active kitchens and approval state</h2></div></div>
            <div className="management-pack__coverage">
              {expectedSites.map((site) => {
                const report = reportBySite.get(site.id);
                return <div className="management-pack__coverage-row" key={site.id}><div><strong>{site.name}</strong><span>{site.code}</span></div>{report ? <StatusBadge status={report.status} /> : <span className="status-badge status-badge--draft">Not started</span>}</div>;
              })}
              {!expectedSites.length ? <div className="empty-inline empty-inline--compact">No active reporting kitchens are configured for this week.</div> : null}
            </div>
          </section>

          <section className="management-pack__section">
            <div className="management-pack__section-heading"><div><span>Kitchen comparison</span><h2>Commercial performance by site</h2></div></div>
            <div className="table-scroll management-pack__table-wrap">
              <table className="data-table management-pack__table">
                <thead><tr><th>Kitchen</th><th>Net sales</th><th>Food</th><th>Labour</th><th>Waste</th><th>Prime cost</th><th>Checks</th></tr></thead>
                <tbody>
                  {approvedReports.map((report) => <tr key={report.id}><td><strong>{report.siteName}</strong><span>{report.manager}</span></td><td>{formatCurrency(report.costs.netSales)}</td><td>{formatPercentage(report.costs.foodCostPct)}<span>{percentagePointVariance(report.costs.foodCostPct, report.costs.foodCostTarget)}</span></td><td>{formatPercentage(report.costs.labourPct)}<span>{percentagePointVariance(report.costs.labourPct, report.costs.labourTarget)}</span></td><td>{formatPercentage(report.costs.wastePct)}<span>{percentagePointVariance(report.costs.wastePct, report.costs.wasteTarget)}</span></td><td>{formatPercentage(report.costs.primeCostPct)}<span>{formatCurrency(report.costs.primeCost)}</span></td><td>{report.costs.flags.filter((flag) => flag.severity !== "info").length}</td></tr>)}
                  {!approvedReports.length ? <tr><td colSpan={7}>No approved kitchen figures are available.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="management-pack__group-narrative">
            <article><h3>Key wins</h3>{wins.length ? <ul>{wins.map((item) => <li key={`${item.site}-${item.text}`}><strong>{item.site}:</strong> {item.text}</li>)}</ul> : <p>No material wins were recorded.</p>}</article>
            <article><h3>Risks and issues</h3>{risks.length ? <ul>{risks.map((item) => <li key={`${item.site}-${item.label}-${item.text}`}><strong>{item.site} · {item.label}:</strong> {item.text}</li>)}</ul> : <p>No material operational, staffing, compliance or equipment issues were recorded.</p>}</article>
            <article><h3>Actions underway</h3>{groupActions.length ? <ul>{groupActions.map((item) => <li key={`${item.site}-${item.text}`}><strong>{item.site}:</strong> {item.text}</li>)}</ul> : <p>No follow-up actions were recorded.</p>}</article>
            <article><h3>Group support required</h3>{supportRequests.length ? <ul>{supportRequests.map((item) => <li key={`${item.site}-${item.text}`}><strong>{item.site}:</strong> {item.text}</li>)}</ul> : <p>No group support requests were recorded.</p>}</article>
          </section>
        </div>
      </section>

      <div className="management-pack__site-list">
        {approvedReports.map((report, index) => {
          const wasteCost = report.costs.netSales * report.costs.wastePct / 100;
          const manualPurchases = report.manualPurchases ?? [];
          const manualPurchaseTotal = manualPurchases.reduce((total, item) => total + item.amount, 0);
          const actionableFlags = report.costs.flags.filter((flag) => flag.severity !== "info");
          return (
            <section className="panel management-pack__site" key={report.id}>
              <div className="panel__header management-pack__site-header">
                <div><p className="management-pack__site-number">Kitchen {index + 1} of {approvedReports.length} · {report.costs.code}</p><h2 className="panel__title">{report.siteName}</h2><p className="panel__subtitle">{report.manager} · week ending {formatDate(report.weekEnd)}</p></div>
                <StatusBadge status={report.status} />
              </div>
              <div className="panel__body stack">
                <section className="management-pack__metric-grid management-pack__metric-grid--site" aria-label={`${report.siteName} metrics`}>
                  <article className="management-pack__metric"><span>Net sales</span><strong>{formatCurrency(report.costs.netSales)}</strong><small>Approved weekly total</small></article>
                  <article className="management-pack__metric"><span>{report.costs.foodCostBasis === "stock_adjusted" ? "Food cost" : "Food spend"}</span><strong>{formatPercentage(report.costs.foodCostPct)}</strong><small>{formatCurrency(report.costs.cogs)} · {percentagePointVariance(report.costs.foodCostPct, report.costs.foodCostTarget)}</small></article>
                  <article className="management-pack__metric"><span>Labour</span><strong>{formatPercentage(report.costs.labourPct)}</strong><small>{formatCurrency(report.costs.staffCost)} · {percentagePointVariance(report.costs.labourPct, report.costs.labourTarget)}</small></article>
                  <article className="management-pack__metric"><span>Waste</span><strong>{formatPercentage(report.costs.wastePct)}</strong><small>{formatCurrency(wasteCost)} · {percentagePointVariance(report.costs.wastePct, report.costs.wasteTarget)}</small></article>
                  <article className="management-pack__metric"><span>Prime cost</span><strong>{formatPercentage(report.costs.primeCostPct)}</strong><small>{formatCurrency(report.costs.primeCost)}</small></article>
                  <article className="management-pack__metric"><span>Open checks</span><strong>{actionableFlags.length}</strong><small>{actionableFlags.length ? actionableFlags.map((flag) => flag.label).join(" · ") : "No automated exceptions"}</small></article>
                </section>

                <section className="management-pack__control-strip" aria-label={`${report.siteName} reporting controls`}>
                  <div><span>Stocktake</span><strong>{report.sources?.stocktakeCompleted ? "Completed" : "Not completed"}</strong></div>
                  <div><span>Pending credits</span><strong>{formatCurrency(report.sources?.pendingCredits ?? 0)}</strong></div>
                  <div><span>Awaiting invoice</span><strong>{formatCurrency(report.sources?.awaitingInvoice ?? 0)}</strong></div>
                  <div><span>Manual purchases</span><strong>{formatCurrency(manualPurchaseTotal)}</strong><small>{manualPurchases.length} item{manualPurchases.length === 1 ? "" : "s"}</small></div>
                </section>

                {actionableFlags.length ? <section className="management-pack__exceptions"><AlertTriangle aria-hidden="true" size={18} /><div><h3>Management checks</h3>{actionableFlags.map((flag) => <p key={flag.code}><strong>{flag.label}:</strong> {flag.detail}</p>)}</div></section> : <section className="management-pack__exceptions management-pack__exceptions--clear"><CheckCircle2 aria-hidden="true" size={18} /><div><h3>No automated exceptions</h3><p>This report has no warning or critical review flags.</p></div></section>}

                <section className="management-pack__narrative-grid">
                  <article><h3>Wins</h3><p>{narrativeOrFallback(report.wins, "No material win recorded.")}</p></article>
                  <article><h3>Operational issues</h3><p>{narrativeOrFallback(report.operationalIssues, "No operational issue recorded.")}</p></article>
                  <article><h3>Staffing</h3><p>{narrativeOrFallback(report.staffingIssues, "No staffing issue recorded.")}</p></article>
                  <article><h3>Compliance</h3><p>{narrativeOrFallback(report.complianceIssues, "No compliance issue recorded.")}</p></article>
                  <article><h3>Equipment</h3><p>{narrativeOrFallback(report.equipmentIssues, "No equipment issue recorded.")}</p></article>
                  <article><h3>Actions underway</h3><p>{narrativeOrFallback(report.actionsUnderway, "No follow-up action recorded.")}</p></article>
                  <article className="management-pack__narrative-wide"><h3>Support required from group</h3><p>{narrativeOrFallback(report.supportNeeded, "No group support requested.")}</p></article>
                </section>
              </div>
            </section>
          );
        })}
      </div>

      {!approvedReports.length ? <section className="panel empty-state"><h2>No approved reports are available.</h2><p>Approve at least one active kitchen report before exporting the management pack.</p></section> : null}

      <div className="privacy-callout management-pack__footer-note">
        <CheckCircle2 aria-hidden="true" className="privacy-callout__icon" size={15} />
        This pack contains approved site-level totals only. Individual salaries, hourly rates and employee time entries are excluded by design. Manual purchases, pending credits and invoices are shown where reported.
      </div>
    </div>
  );
}

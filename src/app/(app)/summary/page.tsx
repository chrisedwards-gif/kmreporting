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

const emptyNarrativePattern = /^(?:n\/?a|none|nil|no|not applicable|-+)$/i;

const cleanNarrative = (value: string) => {
  const trimmed = value.trim();
  return !trimmed || emptyNarrativePattern.test(trimmed) ? "" : trimmed;
};

const narrativeOrFallback = (value: string, fallback: string) => cleanNarrative(value) || fallback;

const metricTone = (actual: number, target: number) => {
  if (actual <= target) return "good";
  if (actual <= target + 2) return "watch";
  return "bad";
};

const varianceLabel = (actual: number, target: number) => {
  const variance = actual - target;
  if (Math.abs(variance) < 0.05) return "On target";
  return `${Math.abs(variance).toFixed(1)}pp ${variance < 0 ? "below" : "over"} target`;
};

const coverageLabel = (status?: string) => {
  if (status === "shared") return "Included";
  if (status === "approved") return "Approved";
  if (status === "submitted" || status === "review_required") return "Awaiting approval";
  return "Not started";
};

const coverageTone = (status?: string) => {
  if (status === "shared" || status === "approved") return "good";
  if (status === "submitted" || status === "review_required") return "watch";
  return "muted";
};

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
  const primeTarget = foodTarget + labourTarget;
  const allStockAdjusted = approvedReports.length > 0 && approvedReports.every((report) => report.costs.foodCostBasis === "stock_adjusted");
  const actionableFlagCount = approvedReports.reduce((count, report) => count + report.costs.flags.filter((flag) => flag.severity !== "info").length, 0);
  const releaseLabel = released ? "Released weekly management pack" : ready ? "Approved and ready to release" : "Internal partial management pack";
  const releaseDetail = released
    ? `Released with ${approvedReports.length} of ${expectedSites.length} active reporting kitchens.`
    : ready
      ? "Every active reporting kitchen has named approval. The pack can now be released."
      : `${approvedReports.length} of ${expectedSites.length} active reporting kitchens are approved and included.`;
  const wins = approvedReports
    .map((report) => ({ site: report.siteName, text: cleanNarrative(report.wins) }))
    .filter((item) => item.text);
  const risks = approvedReports.flatMap((report) => [
    { site: report.siteName, label: "Operational", text: cleanNarrative(report.operationalIssues) },
    { site: report.siteName, label: "Staffing", text: cleanNarrative(report.staffingIssues) },
    { site: report.siteName, label: "Compliance", text: cleanNarrative(report.complianceIssues) },
    { site: report.siteName, label: "Equipment", text: cleanNarrative(report.equipmentIssues) },
  ].filter((item) => item.text));
  const groupActions = approvedReports
    .map((report) => ({ site: report.siteName, text: cleanNarrative(report.actionsUnderway) }))
    .filter((item) => item.text);
  const supportRequests = approvedReports
    .map((report) => ({ site: report.siteName, text: cleanNarrative(report.supportNeeded) }))
    .filter((item) => item.text);
  const visibleWins = wins.slice(0, 3);
  const visibleRisks = risks.slice(0, 4);
  const visibleSupport = supportRequests.slice(0, 3);

  return (
    <div className={`management-summary management-report ${released ? "management-summary--released" : "management-summary--partial"}`}>
      <section className={`summary-release-state management-report__screen-status summary-release-state--${released ? "released" : ready ? "ready" : "pending"}`} aria-label="Weekly pack release status">
        <div><span>Week ending {formatDate(week.end)}</span><strong>{releaseLabel}</strong><small>{releaseDetail}</small></div>
        <StatusBadge status={released ? "shared" : ready ? "approved" : "review_required"} />
      </section>

      <header className="page-header management-report__screen-header">
        <div>
          <p className="page-header__eyebrow">Reporting</p>
          <h1 className="page-header__title">Weekly management pack.</h1>
          <p className="page-header__copy">A clear group readout followed by one management page for every approved kitchen.</p>
        </div>
        <div className="page-header__actions">
          <PeriodSelector basePath="/summary" periods={periods} selected={selectedPeriod} />
          <SummaryEmailTest enabled={profile.capabilities.manageGroup && hasApprovedReports} periodId={selectedPeriod} />
          <SummaryControls canRelease={profile.capabilities.approveReports} hasApprovedReports={hasApprovedReports} periodId={selectedPeriod} ready={ready} released={released} weekEnd={week.end} />
        </div>
      </header>

      {!ready ? (
        <div className="privacy-callout management-report__screen-note">
          <LockKeyhole aria-hidden="true" className="privacy-callout__icon" size={15} />
          The export will be marked as partial. {missingReports.length ? `${missingReports.map((site) => site.name).join(", ")} ${missingReports.length === 1 ? "has" : "have"} not submitted.` : "All active kitchens have submitted."} {awaitingApproval.length ? `${awaitingApproval.map((site) => site.name).join(", ")} ${awaitingApproval.length === 1 ? "is" : "are"} awaiting approval.` : ""}
        </div>
      ) : null}

      <main className="management-report__document">
        <section className="management-report__page management-report__page--group">
          <div className="management-report__brand-bar" aria-hidden="true" />
          {!ready ? <div className="management-report__partial-banner">Internal partial management pack - approved kitchen reports only</div> : null}

          <header className="management-report__hero">
            <div>
              <p className="management-report__eyebrow">House of Social · weekly management report</p>
              <h1>Kitchen performance</h1>
              <p>Sunday {formatDate(week.start)} to Saturday {formatDate(week.end)} · prepared for Jake Atkinson</p>
            </div>
            <div className="management-report__hero-status">
              <span>Week ending {formatDate(week.end)}</span>
              <strong className={`management-report__badge management-report__badge--${released ? "good" : ready ? "good" : "watch"}`}>{released ? "Released" : ready ? "Ready to release" : "Internal partial · review required"}</strong>
              <small>{approvedReports.length} of {expectedSites.length} active kitchen{expectedSites.length === 1 ? "" : "s"} included</small>
            </div>
          </header>

          <section className="management-report__section">
            <div className="management-report__section-title"><h2>Group at a glance</h2><p>Approved reports only</p></div>
            <div className="management-report__kpis">
              <article className="management-report__kpi management-report__kpi--primary"><span>Net sales</span><strong>{formatCurrency(totals.sales)}</strong><small>{approvedReports.length} approved kitchen{approvedReports.length === 1 ? "" : "s"}</small></article>
              <article className="management-report__kpi"><span>Prime cost</span><strong>{formatPercentage(primeCostPct)}</strong><small>{formatCurrency(primeCost)} · target {formatPercentage(primeTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(primeCostPct, primeTarget)}`}>{varianceLabel(primeCostPct, primeTarget)}</em></article>
              <article className="management-report__kpi"><span>{allStockAdjusted ? "Food cost" : "Food spend"}</span><strong>{formatPercentage(foodPct)}</strong><small>{formatCurrency(totals.food)} · target {formatPercentage(foodTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(foodPct, foodTarget)}`}>{varianceLabel(foodPct, foodTarget)}</em></article>
              <article className="management-report__kpi"><span>Labour</span><strong>{formatPercentage(labourPct)}</strong><small>{formatCurrency(totals.labour)} · target {formatPercentage(labourTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(labourPct, labourTarget)}`}>{varianceLabel(labourPct, labourTarget)}</em></article>
            </div>
            <div className="management-report__summary-strip" aria-label="Group reporting controls">
              <div><span>Waste</span><strong>{formatPercentage(wastePct)} · {formatCurrency(totals.waste)}</strong><small>{varianceLabel(wastePct, wasteTarget)}</small></div>
              <div><span>Open controls</span><strong>{actionableFlagCount}</strong><small>Warning or critical checks</small></div>
              <div><span>Pending credits</span><strong>{formatCurrency(totals.pendingCredits)}</strong></div>
              <div><span>Awaiting invoice</span><strong>{formatCurrency(totals.awaitingInvoice)}</strong></div>
              <div><span>Manual purchases</span><strong>{formatCurrency(totals.manualPurchases)}</strong></div>
            </div>
          </section>

          <section className="management-report__section">
            <div className="management-report__section-title"><h2>Reporting status</h2><p>Only active reporting kitchens are expected</p></div>
            <div className="management-report__coverage">
              {expectedSites.map((site) => {
                const report = reportBySite.get(site.id);
                return (
                  <article className="management-report__coverage-card" key={site.id}>
                    <div><strong>{site.name}</strong><small>{site.code}{report?.manager ? ` · ${report.manager}` : ""}</small></div>
                    <span className={`management-report__badge management-report__badge--${coverageTone(report?.status)}`}>{coverageLabel(report?.status)}</span>
                  </article>
                );
              })}
              {!expectedSites.length ? <div className="empty-inline empty-inline--compact">No active reporting kitchens are configured for this week.</div> : null}
            </div>
          </section>

          <section className="management-report__section">
            <div className="management-report__section-title"><h2>Management readout</h2><p>The points that need attention this week</p></div>
            <div className="management-report__readout">
              <article className="management-report__read-card management-report__read-card--good">
                <h3>What went well</h3>
                {visibleWins.length ? <ul>{visibleWins.map((item) => <li key={`${item.site}-${item.text}`}><strong>{item.site}:</strong> {item.text}</li>)}</ul> : <p>No material wins were recorded.</p>}
                {wins.length > visibleWins.length ? <small>+ {wins.length - visibleWins.length} more in the kitchen pages</small> : null}
              </article>
              <article className="management-report__read-card management-report__read-card--watch">
                <h3>Needs attention</h3>
                {visibleRisks.length || actionableFlagCount ? <ul>{visibleRisks.map((item) => <li key={`${item.site}-${item.label}-${item.text}`}><strong>{item.site} · {item.label}:</strong> {item.text}</li>)}{actionableFlagCount ? <li><strong>Controls:</strong> {actionableFlagCount} management check{actionableFlagCount === 1 ? "" : "s"} remain open.</li> : null}</ul> : <p>No material risks or control exceptions were recorded.</p>}
                {risks.length > visibleRisks.length ? <small>+ {risks.length - visibleRisks.length} more in the kitchen pages</small> : null}
              </article>
              <article className="management-report__read-card management-report__read-card--action">
                <h3>Decision / support</h3>
                {visibleSupport.length ? <ul>{visibleSupport.map((item) => <li key={`${item.site}-${item.text}`}><strong>{item.site}:</strong> {item.text}</li>)}</ul> : <p>No group support was requested.</p>}
                {!released && actionableFlagCount ? <p><strong>Before release:</strong> resolve the open management controls and complete remaining approvals.</p> : null}
                {supportRequests.length > visibleSupport.length ? <small>+ {supportRequests.length - visibleSupport.length} more in the kitchen pages</small> : null}
              </article>
            </div>
          </section>

          <section className="management-report__section">
            <div className="management-report__section-title"><h2>Kitchen comparison</h2><p>Performance against agreed targets</p></div>
            <div className="management-report__table-wrap">
              <table className="management-report__table">
                <thead><tr><th>Kitchen</th><th>Sales</th><th>Food</th><th>Labour</th><th>Waste</th><th>Prime</th><th>Controls</th></tr></thead>
                <tbody>
                  {approvedReports.map((report) => {
                    const controls = report.costs.flags.filter((flag) => flag.severity !== "info").length;
                    return <tr key={report.id}><td><strong>{report.siteName}</strong><small>{report.manager}</small></td><td>{formatCurrency(report.costs.netSales)}</td><td><strong>{formatPercentage(report.costs.foodCostPct)}</strong><small>{varianceLabel(report.costs.foodCostPct, report.costs.foodCostTarget)}</small></td><td><strong>{formatPercentage(report.costs.labourPct)}</strong><small>{varianceLabel(report.costs.labourPct, report.costs.labourTarget)}</small></td><td><strong>{formatPercentage(report.costs.wastePct)}</strong><small>{varianceLabel(report.costs.wastePct, report.costs.wasteTarget)}</small></td><td><strong>{formatPercentage(report.costs.primeCostPct)}</strong><small>{formatCurrency(report.costs.primeCost)}</small></td><td><span className={`management-report__variance management-report__variance--${controls ? "watch" : "good"}`}>{controls ? `${controls} open` : "Clear"}</span></td></tr>;
                  })}
                  {!approvedReports.length ? <tr><td colSpan={7}>No approved kitchen figures are available.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="management-report__page-footer"><span>House of Social · Internal management information</span><span>Weekly pack · {formatDate(week.end)}</span></footer>
        </section>

        {approvedReports.map((report, index) => {
          const wasteCost = report.costs.netSales * report.costs.wastePct / 100;
          const manualPurchases = report.manualPurchases ?? [];
          const manualPurchaseTotal = manualPurchases.reduce((total, item) => total + item.amount, 0);
          const actionableFlags = report.costs.flags.filter((flag) => flag.severity !== "info");
          const operationalPriorities = [
            { label: "Operational", text: cleanNarrative(report.operationalIssues) },
            { label: "Staffing", text: cleanNarrative(report.staffingIssues) },
            { label: "Compliance", text: cleanNarrative(report.complianceIssues) },
            { label: "Equipment", text: cleanNarrative(report.equipmentIssues) },
          ].filter((item) => item.text);
          const onTrack = !actionableFlags.length
            && report.costs.foodCostPct <= report.costs.foodCostTarget
            && report.costs.labourPct <= report.costs.labourTarget
            && report.costs.wastePct <= report.costs.wasteTarget;

          return (
            <section className="management-report__page management-report__page--site" key={report.id}>
              <div className="management-report__brand-bar" aria-hidden="true" />
              <header className="management-report__site-hero">
                <div><p className="management-report__eyebrow">Kitchen {index + 1} of {approvedReports.length} · {report.costs.code}</p><h1>{report.siteName}</h1><p>{report.manager} · week ending {formatDate(report.weekEnd)}</p></div>
                <div className="management-report__hero-status"><strong className={`management-report__badge management-report__badge--${onTrack ? "good" : "watch"}`}>{onTrack ? "On track" : "Review required"}</strong><small>{report.status === "shared" ? "Shared report" : "Approved report"}</small></div>
              </header>

              <section className="management-report__site-kpis" aria-label={`${report.siteName} commercial metrics`}>
                <article className="management-report__site-kpi"><span>Net sales</span><strong>{formatCurrency(report.costs.netSales)}</strong><small>Approved weekly total</small></article>
                <article className="management-report__site-kpi"><span>Prime cost</span><strong>{formatPercentage(report.costs.primeCostPct)}</strong><small>{formatCurrency(report.costs.primeCost)} · target {formatPercentage(report.costs.foodCostTarget + report.costs.labourTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(report.costs.primeCostPct, report.costs.foodCostTarget + report.costs.labourTarget)}`}>{varianceLabel(report.costs.primeCostPct, report.costs.foodCostTarget + report.costs.labourTarget)}</em></article>
                <article className="management-report__site-kpi"><span>{report.costs.foodCostBasis === "stock_adjusted" ? "Food cost" : "Food spend"}</span><strong>{formatPercentage(report.costs.foodCostPct)}</strong><small>{formatCurrency(report.costs.cogs)} · target {formatPercentage(report.costs.foodCostTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(report.costs.foodCostPct, report.costs.foodCostTarget)}`}>{varianceLabel(report.costs.foodCostPct, report.costs.foodCostTarget)}</em></article>
                <article className="management-report__site-kpi"><span>Labour</span><strong>{formatPercentage(report.costs.labourPct)}</strong><small>{formatCurrency(report.costs.staffCost)} · target {formatPercentage(report.costs.labourTarget)}</small><em className={`management-report__variance management-report__variance--${metricTone(report.costs.labourPct, report.costs.labourTarget)}`}>{varianceLabel(report.costs.labourPct, report.costs.labourTarget)}</em></article>
              </section>

              <section className="management-report__controls" aria-label={`${report.siteName} financial controls`}>
                <div><span>Waste</span><strong>{formatPercentage(report.costs.wastePct)} · {formatCurrency(wasteCost)}</strong><small>{varianceLabel(report.costs.wastePct, report.costs.wasteTarget)}</small></div>
                <div><span>Stocktake</span><strong>{report.sources?.stocktakeCompleted ? "Completed" : "Not completed"}</strong></div>
                <div><span>Pending credits</span><strong>{formatCurrency(report.sources?.pendingCredits ?? 0)}</strong></div>
                <div><span>Awaiting invoice</span><strong>{formatCurrency(report.sources?.awaitingInvoice ?? 0)}</strong></div>
                <div><span>Manual purchases</span><strong>{formatCurrency(manualPurchaseTotal)}</strong><small>{manualPurchases.length} item{manualPurchases.length === 1 ? "" : "s"}</small></div>
              </section>

              {actionableFlags.length ? (
                <section className="management-report__alert management-report__alert--watch"><AlertTriangle aria-hidden="true" size={18} /><div><h2>Management controls to resolve</h2>{actionableFlags.map((flag) => <p key={flag.code}><strong>{flag.label}:</strong> {flag.detail}</p>)}</div></section>
              ) : (
                <section className="management-report__alert management-report__alert--good"><CheckCircle2 aria-hidden="true" size={18} /><div><h2>Management controls clear</h2><p>No warning or critical review checks remain open.</p></div></section>
              )}

              <section className="management-report__narrative-grid">
                <article className="management-report__narrative management-report__narrative--good"><h2>What went well</h2><p>{narrativeOrFallback(report.wins, "No material win was recorded.")}</p></article>
                <article className="management-report__narrative management-report__narrative--watch"><h2>Operational priorities</h2>{operationalPriorities.length ? <ul>{operationalPriorities.map((item) => <li key={`${item.label}-${item.text}`}><strong>{item.label}:</strong> {item.text}</li>)}</ul> : <p>No operational, staffing, compliance or equipment issue was reported.</p>}</article>
                <article className="management-report__narrative"><h2>Actions underway</h2><p>{narrativeOrFallback(report.actionsUnderway, "No follow-up action was recorded. An owner and deadline should be agreed before the next weekly pack.")}</p></article>
                <article className="management-report__narrative"><h2>Support required from group</h2><p>{narrativeOrFallback(report.supportNeeded, "No group support was requested.")}</p></article>
              </section>

              <footer className="management-report__page-footer"><span>House of Social · {report.siteName}</span><span>Weekly management report · {formatDate(report.weekEnd)}</span></footer>
            </section>
          );
        })}
      </main>

      {!approvedReports.length ? <section className="panel empty-state"><h2>No approved reports are available.</h2><p>Approve at least one active kitchen report before exporting the management pack.</p></section> : null}

      <div className="privacy-callout management-report__screen-footer">
        <CheckCircle2 aria-hidden="true" className="privacy-callout__icon" size={15} />
        The pack contains approved site-level totals only. Individual salaries, hourly rates and employee time entries are excluded. Manual purchases, credits and invoices are shown where reported.
      </div>
    </div>
  );
}

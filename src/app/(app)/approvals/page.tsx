import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Share2, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { PeriodSelector } from "@/components/reports/period-selector";
import { getReportingBundle, getReportingPeriods } from "@/lib/data/reporting";
import { formatPercentage } from "@/lib/utils";
import { requireRole } from "@/lib/auth/dal";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireRole(["admin", "group_manager"]);
  const { period } = await searchParams;
  const periods = await getReportingPeriods();
  const selectedPeriod = periods.some((item) => item.id === period) ? period : periods[0]?.id;
  const { reports, expectedSites } = await getReportingBundle(selectedPeriod);
  const pending = reports.filter((report) => ["submitted", "review_required"].includes(report.status));
  const approvedOrShared = reports.filter((report) => ["approved", "shared"].includes(report.status));
  const reportBySite = new Map(reports.map((report) => [report.siteId, report]));
  const outstanding = expectedSites
    .map((site) => ({ site, report: reportBySite.get(site.id) }))
    .filter((item) => !item.report || item.report.status === "draft");
  const draftCount = outstanding.filter((item) => item.report?.status === "draft").length;
  const notStartedCount = outstanding.length - draftCount;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Controlled workflow</p>
          <h1 className="page-header__title">Review before sharing.</h1>
          <p className="page-header__copy">Automated checks focus attention; a named manager still makes the approval decision.</p>
        </div>
        <PeriodSelector basePath="/approvals" periods={periods} selected={selectedPeriod} />
      </header>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Needs a decision</h2><p className="panel__subtitle">{pending.length} waiting for approval · {outstanding.length} not submitted</p></div><ShieldAlert aria-hidden="true" color="#c78324" size={19} /></div>
          <div className="panel__body">
            <div className="report-list">
              {pending.map((report) => (
                <Link className="review-item" href={`/reports/${report.id}`} key={report.id}>
                  <div className="approval-card__top">
                    <div><div className="review-item__site">{report.costs.code}</div><div className="review-item__label">{report.siteName}</div></div>
                    <StatusBadge status={report.status} />
                  </div>
                  <div className="review-item__detail approval-card__meta">
                    {report.costs.foodCostBasis === "stock_adjusted" ? "Food" : "Spend"} {formatPercentage(report.costs.foodCostPct)} · Labour {formatPercentage(report.costs.labourPct)} · {report.costs.flags.filter((flag) => flag.severity !== "info").length} actionable checks
                  </div>
                  <div className="approval-card__cta">Open decision <ArrowRight aria-hidden="true" size={14} /></div>
                </Link>
              ))}
              {!pending.length ? <div className="empty-inline empty-inline--compact">Nothing is waiting for approval.</div> : null}
            </div>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Workflow guardrails</h2><p className="panel__subtitle">Sharing is a separate permissioned action</p></div></div>
            <div className="panel__body">
              <div className="review-list">
                <div className="review-item review-item--info"><Clock3 aria-hidden="true" size={16} /><div className="review-item__label">1. Kitchen submits</div><div className="review-item__detail">Period and required source totals are validated.</div></div>
                <div className="review-item"><ShieldAlert aria-hidden="true" size={16} /><div className="review-item__label">2. Manager reviews</div><div className="review-item__detail">Cost exceptions, compliance and support requests are resolved.</div></div>
                <div className="review-item review-item--info"><CheckCircle2 aria-hidden="true" size={16} /><div className="review-item__label">3. Named approval</div><div className="review-item__detail">The decision, approver and timestamp enter the audit log.</div></div>
                <div className="review-item review-item--info"><Share2 aria-hidden="true" size={16} /><div className="review-item__label">4. Controlled share</div><div className="review-item__detail">The app records the share decision. Email delivery is separate and only occurs when a delivery webhook is configured.</div></div>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Still outstanding</h2><p className="panel__subtitle">{notStartedCount} not started · {draftCount} saved as draft</p></div></div>
            <div className="panel__body">
              {outstanding.map(({ site, report }) => (
                <div className="cost-summary__row" key={site.id}>
                  <span className="cost-summary__label">{site.name}</span>
                  {report
                    ? <Link aria-label={`Open ${site.name} draft`} href={`/reports/new?report=${report.id}`}><StatusBadge status="draft" /></Link>
                    : <span className="status-badge status-badge--draft">Not started</span>}
                </div>
              ))}
              {!outstanding.length ? <div className="empty-inline empty-inline--compact">Every expected kitchen has submitted a report.</div> : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Approved or shared this week</h2><p className="panel__subtitle">Approved reports remain visible after a share is recorded</p></div></div>
            <div className="panel__body">
              {approvedOrShared.map((report) => <div className="cost-summary__row" key={report.id}><span className="cost-summary__label">{report.siteName}</span><StatusBadge status={report.status} /></div>)}
              {!approvedOrShared.length ? <div className="empty-inline empty-inline--compact">No reports have been approved for this week yet.</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldAlert } from "lucide-react";
import { ApprovalForm } from "@/components/reports/approval-form";
import { getSessionProfile } from "@/lib/auth/dal";
import { roleCanApprove } from "@/lib/data/reporting";
import { StatusBadge } from "@/components/ui/status-badge";
import { getReportingBundle } from "@/lib/data/reporting";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Report review" };

export default async function ReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { reports } = await getReportingBundle();
  const report = reports.find((item) => item.siteId === reportId || item.id === reportId);
  if (!report) notFound();
  const profile = await getSessionProfile();

  const narrative = [
    ["Wins & guest feedback", report.wins],
    ["Operational issues", report.operationalIssues],
    ["Staffing issues", report.staffingIssues],
    ["Compliance issues", report.complianceIssues],
    ["Equipment issues", report.equipmentIssues],
    ["Actions underway", report.actionsUnderway],
    ["Support needed", report.supportNeeded],
  ].filter(([, value]) => value);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{report.costs.code} · Week ending {formatDate(report.weekEnd)}</p>
          <h1 className="page-header__title">{report.siteName}</h1>
          <p className="page-header__copy">Submitted by {report.manager}. Financial outputs are current safe aggregates; no pay rates are included.</p>
        </div>
        <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
          <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> Reports</Link>
        </div>
      </header>

      <div className="report-detail-grid">
        <section className="panel">
          <div className="panel__header">
            <div><h2 className="panel__title">Management update</h2><p className="panel__subtitle">Manager narrative preserved as submitted</p></div>
            <StatusBadge status={report.status} />
          </div>
          <div className="narrative-grid">
            {narrative.map(([label, value]) => (
              <article className="narrative-item" key={label}><h3>{label}</h3><p>{value}</p></article>
            ))}
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Cost summary</h2><p className="panel__subtitle">Calculated from source data</p></div><LockKeyhole aria-hidden="true" color="#2d7a62" size={18} /></div>
            <div className="panel__body">
              <div className="cost-summary">
                <div className="cost-summary__row"><span className="cost-summary__label">Net sales</span><span className="cost-summary__value">{formatCurrency(report.costs.netSales)}</span></div>
                <div className="cost-summary__row"><span className="cost-summary__label">COGS</span><span className="cost-summary__value">{formatCurrency(report.costs.cogs)} · {formatPercentage(report.costs.foodCostPct)}</span></div>
                <div className="cost-summary__row"><span className="cost-summary__label">Staff cost</span><span className="cost-summary__value">{formatCurrency(report.costs.staffCost)} · {formatPercentage(report.costs.labourPct)}</span></div>
                <div className="cost-summary__row"><span className="cost-summary__label">Prime cost</span><span className="cost-summary__value">{formatCurrency(report.costs.primeCost)} · {formatPercentage(report.costs.primeCostPct)}</span></div>
              </div>
              <div className="privacy-callout" style={{ marginTop: "1rem" }}>Salary and hourly-rate records stay inside the private database schema. This report only stores the resulting site total.</div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Approval gates</h2><p className="panel__subtitle">All must clear before sharing</p></div><ShieldAlert aria-hidden="true" color="#c78324" size={18} /></div>
            <div className="panel__body">
              {report.costs.flags.length ? (
                <div className="review-list">
                  {report.costs.flags.map((flag) => <div className={`review-item review-item--${flag.severity}`} key={flag.code}><div className="review-item__label">{flag.label}</div><div className="review-item__detail">{flag.detail}</div></div>)}
                </div>
              ) : (
                <div className="privacy-callout"><CheckCircle2 aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".35rem", verticalAlign: "text-bottom" }} />All automated checks have passed.</div>
              )}
            </div>
          </section>
          {profile && roleCanApprove(profile.role) && (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Management decision</h2><p className="panel__subtitle">Named, timestamped and added to the audit trail</p></div></div>
              <div className="panel__body"><ApprovalForm hasFlags={report.costs.flags.length > 0} reportId={report.id} status={report.status} /></div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

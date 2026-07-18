import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Share2, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getReportingBundle } from "@/lib/data/reporting";
import { formatPercentage } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { reports } = await getReportingBundle();
  const pending = reports.filter((report) => ["submitted", "review_required"].includes(report.status));
  const approved = reports.filter((report) => report.status === "approved");
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Controlled workflow</p>
          <h1 className="page-header__title">Review before sharing.</h1>
          <p className="page-header__copy">Automated checks focus attention; a named manager still makes the approval decision.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Needs a decision</h2><p className="panel__subtitle">{pending.length} kitchen reports waiting</p></div><ShieldAlert aria-hidden="true" color="#c78324" size={19} /></div>
          <div className="panel__body">
            <div className="report-list">
              {pending.map((report) => (
                <Link className="review-item" href={`/reports/${report.id}`} key={report.id}>
                  <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                    <div><div className="review-item__site">{report.costs.code}</div><div className="review-item__label">{report.siteName}</div></div>
                    <StatusBadge status={report.status} />
                  </div>
                  <div className="review-item__detail" style={{ marginTop: ".6rem" }}>
                    Food {formatPercentage(report.costs.foodCostPct)} · Labour {formatPercentage(report.costs.labourPct)} · {report.costs.flags.length} review checks
                  </div>
                  <div style={{ alignItems: "center", display: "flex", fontSize: ".72rem", fontWeight: 750, gap: ".3rem", marginTop: ".65rem" }}>Open decision <ArrowRight aria-hidden="true" size={14} /></div>
                </Link>
              ))}
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
                <div className="review-item review-item--info"><Share2 aria-hidden="true" size={16} /><div className="review-item__label">4. Controlled share</div><div className="review-item__detail">Only approved safe summaries can be sent outside the app.</div></div>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Approved this week</h2><p className="panel__subtitle">Ready for controlled sharing</p></div></div>
            <div className="panel__body">
              {approved.map((report) => <div className="cost-summary__row" key={report.id}><span className="cost-summary__label">{report.siteName}</span><StatusBadge status={report.status} /></div>)}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

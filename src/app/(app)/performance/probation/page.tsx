import Link from "next/link";
import { CalendarClock, Scale } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { getProbationSummaries } from "@/lib/data/performance";
import { scoreRag } from "@/lib/performance/scoring";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Manager probation" };

export default async function ProbationPage() {
  await requireRole(["admin", "group_manager"]);
  const managers = await getProbationSummaries();

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Performance</p><h1 className="page-header__title">Probation scorecards.</h1><p className="page-header__copy">Role-weighted scores use the latest finalised 1-1 evidence. Missing areas are ignored rather than treated as zero.</p></div></header>
      <div className="manager-grid">
        {managers.map((manager) => (
          <section className="panel manager-card" key={manager.managerId}>
            <div className="panel__header"><div><h2 className="panel__title">{manager.fullName}</h2><p className="panel__subtitle">{manager.roleTitle} · {manager.siteName}</p></div>{manager.weightedScore !== null ? <span className={`score-pill score-pill--${scoreRag(manager.weightedScore)}`}>{manager.weightedScore.toFixed(1)}</span> : null}</div>
            <div className="panel__body">
              <div className="probation-stage"><CalendarClock aria-hidden="true" size={16} /><div><strong>{manager.stageLabel}</strong><span>{manager.employmentStartDate ? `Started ${formatDate(manager.employmentStartDate)}` : "Set a start date in Manager admin"}</span></div></div>
              <div className="manager-card__stats"><span><strong>{manager.reviewCount}</strong> finalised reviews</span><span><strong>{manager.latestReviewDate ? formatDate(manager.latestReviewDate) : "—"}</strong> latest evidence</span></div>
              <details className="manager-history"><summary><Scale aria-hidden="true" size={14} /> Role weights</summary><div className="weight-grid">{Object.entries(manager.weights).map(([area, weight]) => <div className="weight-grid__row" key={area}><span>{area.replaceAll("_", " ")}</span><strong>{Math.round(weight * 100)}%</strong></div>)}</div></details>
              <Link className="button button--secondary" href={`/one-to-ones?manager=${manager.managerId}`}>Open review history</Link>
            </div>
          </section>
        ))}
        {!managers.length ? <section className="panel empty-state"><h2>No manager scorecards yet.</h2><p>Add employment dates in Manager admin and finalise a 1-1 to create the first scorecard.</p></section> : null}
      </div>
    </>
  );
}

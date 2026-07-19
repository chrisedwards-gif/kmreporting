import Link from "next/link";
import { CalendarPlus, ClipboardCheck, Flame, Link2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { getManagers, getOneToOnes, getOpenActions } from "@/lib/data/one-to-ones";
import { isActionOverdue, scoreRag } from "@/lib/performance/scoring";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Manager 1-1s" };

const reviewStatusMap = {
  draft: "draft",
  in_review: "submitted",
  reopened: "review_required",
  finalised: "approved",
  acknowledged: "shared",
} as const;

export default async function OneToOnesPage() {
  await requireRole(["admin", "group_manager", "finance", "viewer"]);
  const [managers, reviews] = await Promise.all([getManagers(), getOneToOnes()]);
  const uniqueManagerIds = [...new Set(managers.map((manager) => manager.id))];
  const openActionsByManager = new Map(
    await Promise.all(uniqueManagerIds.map(async (managerId) => [managerId, await getOpenActions(managerId)] as const)),
  );
  const week = getLatestCompletedReportingWeek();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Performance</p>
          <h1 className="page-header__title">Manager 1-1s.</h1>
          <p className="page-header__copy">
            Each card comes from the kitchen&apos;s current primary-manager assignment. The person UUID is their login UUID; the assignment supplies the kitchen and preserves every previous manager&apos;s history.
          </p>
        </div>
      </header>

      <div className="manager-grid">
        {managers.map((manager) => {
          const managerReviews = reviews.filter((review) => review.managerId === manager.id);
          const assignmentReviews = reviews.filter((review) => review.assignmentId === manager.assignmentId);
          const latestScored = managerReviews.find((review) => review.overallScore !== null);
          const openActions = openActionsByManager.get(manager.id) ?? [];
          const overdue = openActions.filter((item) => isActionOverdue(item.dueDate, item.status, today)).length;
          const currentWeekReview = assignmentReviews.find((review) => review.weekCommencing === week.start);
          const assignedForWeek = manager.assignmentStartsOn <= week.end && (!manager.assignmentEndsOn || manager.assignmentEndsOn >= week.start);
          return (
            <section className="panel manager-card" key={manager.assignmentId}>
              <div className="panel__header">
                <div>
                  <h2 className="panel__title">{manager.fullName}</h2>
                  <p className="panel__subtitle">{manager.roleTitle} · {manager.siteName}</p>
                </div>
                {latestScored?.overallScore != null && (
                  <span className={`score-pill score-pill--${scoreRag(latestScored.overallScore)}`}>{latestScored.overallScore.toFixed(1)}</span>
                )}
              </div>
              <div className="panel__body">
                <div className="manager-card__identity"><Link2 aria-hidden="true" size={14} /> One login identity · assigned from {formatDate(manager.assignmentStartsOn)}</div>
                {manager.focusAreas.length ? (
                  <div className="manager-card__focus">
                    {manager.focusAreas.slice(0, 6).map((area) => (
                      <span className="source-chip" key={area}>{area}</span>
                    ))}
                  </div>
                ) : null}
                <div className="manager-card__stats">
                  <span><strong>{openActions.length}</strong> open actions</span>
                  <span className={overdue ? "manager-card__stat--overdue" : ""}><strong>{overdue}</strong> overdue</span>
                  <span><strong>{managerReviews.length}</strong> reviews</span>
                </div>
                {currentWeekReview ? (
                  <Link className="button button--secondary" href={`/one-to-ones/${currentWeekReview.id}`}>
                    <ClipboardCheck aria-hidden="true" size={16} /> Open this week&apos;s 1-1
                  </Link>
                ) : assignedForWeek ? (
                  <Link className="button button--primary" href={`/one-to-ones/new?assignment=${manager.assignmentId}`}>
                    <CalendarPlus aria-hidden="true" size={16} /> Start 1-1 for w/c {formatDate(week.start)}
                  </Link>
                ) : (
                  <div className="privacy-callout">This manager started after the latest completed reporting week. Their first 1-1 will open once a full assigned week has completed.</div>
                )}
              </div>
            </section>
          );
        })}
        {!managers.length && (
          <section className="panel empty-state">
            <Flame aria-hidden="true" size={22} />
            <h2>No primary kitchen managers assigned.</h2>
            <p>Open Sites & access and assign one primary manager to each kitchen. Their existing login UUID becomes the person record automatically.</p>
          </section>
        )}
      </div>

      {reviews.length > 0 && (
        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Review history</h2><p className="panel__subtitle">Manager changes do not rewrite previous reviews</p></div></div>
          <div className="report-list">
            {reviews.map((review) => (
              <Link className="report-row report-row--slim" href={`/one-to-ones/${review.id}`} key={review.id}>
                <div className="site-cell">
                  <div className="site-cell__mark">{review.managerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                  <div>
                    <div className="site-cell__name">{review.managerName}</div>
                    <div className="site-cell__manager">{review.siteName} · Week commencing {formatDate(review.weekCommencing)}</div>
                  </div>
                </div>
                <div>
                  <span className="report-row__metric-label">Overall</span>
                  {review.overallScore === null ? "—" : review.overallScore.toFixed(1)}
                </div>
                <StatusBadge status={reviewStatusMap[review.status]} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

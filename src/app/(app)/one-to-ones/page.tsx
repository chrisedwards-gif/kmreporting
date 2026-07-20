import Link from "next/link";
import { CalendarPlus, ClipboardCheck, Flame, Link2, ListChecks, Scale, UserRoundCog } from "lucide-react";
import { PerformanceTrendChart } from "@/components/performance/performance-trend-chart";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { getManagers, getOneToOnes, getOpenActions } from "@/lib/data/one-to-ones";
import { getPerformanceTrends } from "@/lib/data/performance";
import { isActionOverdue, scoreRag } from "@/lib/performance/scoring";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Manager 1-1s" };
const reviewStatusMap = { draft: "draft", in_review: "submitted", reopened: "review_required", finalised: "approved", acknowledged: "shared" } as const;

export default async function OneToOnesPage({ searchParams }: { searchParams: Promise<{ manager?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const { manager } = await searchParams;
  const selectedManager = profile.isAccessPreview ? profile.previewManagerId ?? undefined : profile.role === "kitchen_manager" ? profile.id : manager;
  const [allManagers, allReviews, trends] = await Promise.all([getManagers(), getOneToOnes(selectedManager), getPerformanceTrends(selectedManager)]);
  const managers = selectedManager ? allManagers.filter((item) => item.id === selectedManager && (!profile.previewSiteId || item.siteId === profile.previewSiteId)) : allManagers;
  const reviews = profile.previewSiteId ? allReviews.filter((item) => item.siteId === profile.previewSiteId) : allReviews;
  const canManage = !profile.isAccessPreview && ["admin", "group_manager"].includes(profile.role);
  const uniqueManagerIds = [...new Set(managers.map((item) => item.id))];
  const openActionsByManager = new Map(await Promise.all(uniqueManagerIds.map(async (managerId) => [managerId, await getOpenActions(managerId)] as const)));
  const openDrafts = reviews.filter((review) => ["draft", "in_review", "reopened"].includes(review.status));
  const history = reviews.filter((review) => !["draft", "in_review", "reopened"].includes(review.status));
  const week = getLatestCompletedReportingWeek();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Performance</p><h1 className="page-header__title">{profile.role === "kitchen_manager" ? "My 1-1s." : "Manager 1-1s."}</h1><p className="page-header__copy">Review previous meetings, current priorities and the actions that carry forward until complete.</p></div><div className="page-header__actions"><Link className="button button--secondary" href="/performance/actions"><ListChecks aria-hidden="true" size={15} /> Action log</Link>{profile.role !== "kitchen_manager" ? <Link className="button button--secondary" href="/performance/probation"><Scale aria-hidden="true" size={15} /> Probation</Link> : null}{profile.role === "admin" ? <Link className="button button--secondary" href="/performance/managers"><UserRoundCog aria-hidden="true" size={15} /> Manager admin</Link> : null}</div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Read-only preview of {profile.previewManagerName ?? "this manager"} at {profile.previewSiteName}. A real manager can acknowledge finalised reviews and update their own actions.</div> : null}
      {openDrafts.length ? <section className="panel panel--attention"><div className="panel__header"><div><h2 className="panel__title">Open drafts</h2><p className="panel__subtitle">Saved management work that can be continued</p></div><span className="status-badge status-badge--draft">{openDrafts.length} open</span></div><div className="report-list">{openDrafts.map((review) => <Link className="report-row report-row--slim" href={`/one-to-ones/${review.id}`} key={review.id}><div className="site-cell"><div className="site-cell__mark">{review.managerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><div className="site-cell__name">{review.managerName}</div><div className="site-cell__manager">{review.siteName} · w/c {formatDate(review.weekCommencing)}</div></div></div><div><span className="report-row__metric-label">Progress</span>{review.overallScore === null ? "Not finalised" : review.overallScore.toFixed(1)}</div><span className="button button--secondary button--compact"><ClipboardCheck aria-hidden="true" size={14} /> View draft</span></Link>)}</div></section> : null}
      <div className="manager-grid">{managers.map((managerRecord) => {
        const managerReviews = reviews.filter((review) => review.managerId === managerRecord.id);
        const assignmentReviews = reviews.filter((review) => review.assignmentId === managerRecord.assignmentId);
        const latestScored = managerReviews.find((review) => review.overallScore !== null);
        const openActions = (openActionsByManager.get(managerRecord.id) ?? []).filter((action) => !profile.previewSiteId || action.siteId === profile.previewSiteId);
        const overdue = openActions.filter((item) => isActionOverdue(item.dueDate, item.status, today)).length;
        const currentWeekReview = assignmentReviews.find((review) => review.weekCommencing === week.start);
        const assignedForWeek = managerRecord.assignmentStartsOn <= week.end && (!managerRecord.assignmentEndsOn || managerRecord.assignmentEndsOn >= week.start);
        return <section className="panel manager-card" key={managerRecord.assignmentId}><div className="panel__header"><div><h2 className="panel__title">{managerRecord.fullName}</h2><p className="panel__subtitle">{managerRecord.roleTitle} · {managerRecord.siteName}</p></div>{latestScored?.overallScore != null ? <span className={`score-pill score-pill--${scoreRag(latestScored.overallScore)}`}>{latestScored.overallScore.toFixed(1)}</span> : null}</div><div className="panel__body"><div className="manager-card__identity"><Link2 aria-hidden="true" size={14} /> One login identity · assigned from {formatDate(managerRecord.assignmentStartsOn)}</div>{managerRecord.focusAreas.length ? <div className="manager-card__focus">{managerRecord.focusAreas.slice(0, 6).map((area) => <span className="source-chip" key={area}>{area}</span>)}</div> : null}<div className="manager-card__stats"><span><strong>{openActions.length}</strong> open actions</span><span className={overdue ? "manager-card__stat--overdue" : ""}><strong>{overdue}</strong> overdue</span><span><strong>{managerReviews.length}</strong> reviews</span></div>{currentWeekReview ? <Link className="button button--secondary" href={`/one-to-ones/${currentWeekReview.id}`}><ClipboardCheck aria-hidden="true" size={16} /> Open this week&apos;s 1-1</Link> : canManage && assignedForWeek ? <Link className="button button--primary" href={`/one-to-ones/new?assignment=${managerRecord.assignmentId}`}><CalendarPlus aria-hidden="true" size={16} /> Start 1-1 for w/c {formatDate(week.start)}</Link> : assignedForWeek ? <div className="privacy-callout">The next review will appear here after group management starts it.</div> : <div className="privacy-callout">The first review opens once a full assigned reporting week has completed.</div>}</div></section>;
      })}{!managers.length ? <section className="panel empty-state"><Flame aria-hidden="true" size={22} /><h2>No primary manager assignment found.</h2><p>Assign a primary manager in Sites & access to create their 1-1 history.</p></section> : null}</div>
      <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Performance trend</h2><p className="panel__subtitle">Overall score from finalised reviews</p></div></div><div className="panel__body"><PerformanceTrendChart points={profile.previewSiteId ? trends.filter((point) => point.siteName === profile.previewSiteName) : trends} /></div></section>
      {history.length > 0 ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Finalised review history</h2><p className="panel__subtitle">Manager changes do not rewrite previous reviews</p></div></div><div className="report-list">{history.map((review) => <Link className="report-row report-row--slim" href={`/one-to-ones/${review.id}`} key={review.id}><div className="site-cell"><div className="site-cell__mark">{review.managerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><div className="site-cell__name">{review.managerName}</div><div className="site-cell__manager">{review.siteName} · Week commencing {formatDate(review.weekCommencing)}</div></div></div><div><span className="report-row__metric-label">Overall</span>{review.overallScore === null ? "—" : review.overallScore.toFixed(1)}</div><StatusBadge status={reviewStatusMap[review.status]} /></Link>)}</div></section> : null}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { acknowledgeOneToOne, reopenOneToOne } from "@/app/actions/one-to-ones";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { getSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { getOneToOne, getOpenActions, getReviewActions, getSnapshottedKpis, getWeekKpis } from "@/lib/data/one-to-ones";
import { getWeeklyReportId } from "@/lib/data/report-links";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "1-1 review" };

export default async function OneToOneDetailPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const [detail, profile] = await Promise.all([getOneToOne(reviewId), getSessionProfile()]);
  if (!detail || !profile || !scopeContainsSite(profile.siteScopeIds, detail.siteId) || (profile.scopeManagerId && detail.managerId !== profile.scopeManagerId)) notFound();
  const [liveKpis, openActions, reviewActions, weeklyReportId] = await Promise.all([getWeekKpis(detail.siteId, detail.weekCommencing), getOpenActions(detail.managerId), getReviewActions(detail.id), getWeeklyReportId(detail.siteId, detail.weekCommencing)]);
  const lockedKpis = ["finalised", "acknowledged"].includes(detail.status) ? getSnapshottedKpis(detail.kpiSnapshot) : null;
  const kpis = lockedKpis ?? liveKpis;
  const canManage = profile.capabilities.manageGroup;
  const isNamedManager = profile.id === detail.managerId;
  const canAcknowledge = detail.status === "finalised" && (canManage || isNamedManager);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">{detail.siteName} · Week commencing {formatDate(detail.weekCommencing)}</p><h1 className="page-header__title">{detail.managerName}.</h1><p className="page-header__copy">{detail.status === "acknowledged" ? `Finalised and acknowledged${detail.overallScore !== null ? ` · overall ${detail.overallScore.toFixed(1)}` : ""}.` : detail.status === "finalised" ? "Finalised, locked and available to the manager in their account." : "Draft review — saved management work remains resumable."}</p></div><div className="page-header__actions">{weeklyReportId ? <Link className="button button--secondary" href={`/reports/${weeklyReportId}`}>Open weekly report</Link> : null}<Link className="button button--secondary" href="/performance/actions">Open action log</Link>{canManage && (detail.status === "finalised" || detail.status === "acknowledged") ? <form action={reopenOneToOne} className="reopen-form"><input name="reviewId" type="hidden" value={detail.id} /><input className="field__input" name="reason" placeholder="Reason to reopen" required /><button className="button button--secondary" type="submit">Reopen</button></form> : null}</div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. This review is restricted to {profile.previewManagerName ?? "the assigned manager"}.</div> : null}
      {canAcknowledge ? <section className="panel panel--attention"><div className="panel__header"><div><h2 className="panel__title">Manager review</h2><p className="panel__subtitle">Read the full record and action points below, then acknowledge it</p></div></div><div className="panel__body"><form action={acknowledgeOneToOne} className="report-form"><input name="reviewId" type="hidden" value={detail.id} /><label className="field"><span className="field__label">Manager response or comments (optional)</span><textarea className="field__input" name="response" rows={3} /></label><button className="button button--primary" type="submit">Acknowledge review</button></form></div></section> : null}
      <OneToOneForm assignmentId={detail.assignmentId} detail={detail} initialActions={reviewActions} kpis={kpis} managerFirstName={detail.managerName.split(" ")[0]} managerName={detail.managerName} openActions={openActions.filter((action) => scopeContainsSite(profile.siteScopeIds, action.siteId))} weekCommencing={detail.weekCommencing} />
    </>
  );
}

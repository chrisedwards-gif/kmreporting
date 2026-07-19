import Link from "next/link";
import { notFound } from "next/navigation";
import { acknowledgeOneToOne, reopenOneToOne } from "@/app/actions/one-to-ones";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { getSessionProfile } from "@/lib/auth/dal";
import { getOneToOne, getOpenActions, getReviewActions, getSnapshottedKpis, getWeekKpis } from "@/lib/data/one-to-ones";
import { getWeeklyReportId } from "@/lib/data/report-links";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "1-1 review" };

export default async function OneToOneDetailPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const [detail, profile] = await Promise.all([getOneToOne(reviewId), getSessionProfile()]);
  if (!detail || !profile) notFound();
  if (profile.isAccessPreview && (detail.managerId !== profile.previewManagerId || detail.siteId !== profile.previewSiteId)) notFound();
  const [liveKpis, openActions, reviewActions, weeklyReportId] = await Promise.all([getWeekKpis(detail.siteId, detail.weekCommencing), getOpenActions(detail.managerId), getReviewActions(detail.id), getWeeklyReportId(detail.siteId, detail.weekCommencing)]);
  const lockedKpis = ["finalised", "acknowledged"].includes(detail.status) ? getSnapshottedKpis(detail.kpiSnapshot) : null;
  const kpis = lockedKpis ?? liveKpis;
  const canManage = !profile.isAccessPreview && ["admin", "group_manager"].includes(profile.role);
  const isNamedManager = profile.id === detail.managerId;
  const canAcknowledge = !profile.isAccessPreview && detail.status === "finalised" && (canManage || isNamedManager);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">{detail.siteName} · Week commencing {formatDate(detail.weekCommencing)}</p><h1 className="page-header__title">{detail.managerName}.</h1><p className="page-header__copy">{detail.status === "acknowledged" ? `Finalised and acknowledged${detail.overallScore !== null ? ` · overall ${detail.overallScore.toFixed(1)}` : ""}.` : detail.status === "finalised" ? "Finalised, locked and available to the manager in their account." : "Draft review — saved management work remains resumable."}</p></div><div className="page-header__actions">{weeklyReportId ? <Link className="button button--secondary" href={`/reports/${weeklyReportId}`}>Open weekly report</Link> : null}<Link className="button button--secondary" href="/performance/actions">Open action log</Link>{canManage && (detail.status === "finalised" || detail.status === "acknowledged") ? <form action={reopenOneToOne} className="reopen-form"><input name="reviewId" type="hidden" value={detail.id} /><input className="field__input" name="reason" placeholder="Reason to reopen" required /><button className="button button--secondary" type="submit">Reopen</button></form> : null}</div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Read-only preview. The actual manager can see this record, acknowledge it when finalised and update their actions.</div> : null}
      {canAcknowledge ? <section className="panel panel--attention"><div className="panel__header"><div><h2 className="panel__title">Manager review</h2><p className="panel__subtitle">Read the full record and action points below, then acknowledge it</p></div></div><div className="panel__body"><form action={acknowledgeOneToOne} className="report-form"><input name="reviewId" type="hidden" value={detail.id} /><label className="field"><span className="field__label">Manager response or comments (optional)</span><textarea className="field__input" name="response" rows={3} /></label><button className="button button--primary" type="submit">Acknowledge review</button></form></div></section> : null}
      {profile.isAccessPreview ? (
        <div className="stack">
          <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Weekly KPI snapshot</h2><p className="panel__subtitle">Figures attached to this kitchen and review week</p></div></div><div className="panel__body kpi-grid"><div className="kpi-row"><span>Net sales</span><strong>{kpis.netSales === null ? "—" : formatCurrency(kpis.netSales)}</strong></div><div className="kpi-row"><span>Food GP</span><strong>{kpis.foodGpPct === null ? "—" : `${kpis.foodGpPct}%`}</strong></div><div className="kpi-row"><span>Labour</span><strong>{kpis.labourPct === null ? "—" : `${kpis.labourPct}%`}</strong></div><div className="kpi-row"><span>Waste</span><strong>{kpis.wasteCost === null ? "—" : formatCurrency(kpis.wasteCost)}</strong></div><div className="kpi-row"><span>Report sent</span><strong>{kpis.reportSent ? "Yes" : "No"}</strong></div></div></section>
          <section className="panel"><div className="panel__header"><div><h2 className="panel__title">What was logged</h2><p className="panel__subtitle">Wins, coaching notes and manager comments</p></div></div><div className="panel__body read-only-review-grid">{[...Object.entries(detail.wins), ...Object.entries(detail.summary)].filter(([, value]) => String(value ?? "").trim()).map(([key, value]) => <article key={key}><span>{key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase())}</span><p>{String(value)}</p></article>)}{!Object.values({ ...detail.wins, ...detail.summary }).some((value) => String(value ?? "").trim()) ? <div className="empty-inline">No narrative notes have been saved yet.</div> : null}</div></section>
          <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Scores and actions</h2><p className="panel__subtitle">Development evidence and live follow-up</p></div></div><div className="panel__body"><div className="score-list">{detail.scores.map((score) => <div className="carry-row" key={score.area}><div><div className="carry-row__action">{score.area.replaceAll("_", " ")} · {score.score ?? "—"}/5</div><div className="carry-row__meta">{score.evidence || "No evidence recorded"}{score.developmentNote ? ` · ${score.developmentNote}` : ""}</div></div></div>)}</div><div className="score-list">{reviewActions.map((action) => <div className="carry-row" key={action.id}><div><div className="carry-row__action">{action.action}</div><div className="carry-row__meta">{action.status.replaceAll("_", " ")}{action.dueDate ? ` · due ${formatDate(action.dueDate)}` : ""}</div></div></div>)}{!reviewActions.length ? <div className="empty-inline">No agreed actions on this review.</div> : null}</div></div></section>
        </div>
      ) : <OneToOneForm assignmentId={detail.assignmentId} detail={detail} initialActions={reviewActions} kpis={kpis} managerFirstName={detail.managerName.split(" ")[0]} managerName={detail.managerName} openActions={openActions} weekCommencing={detail.weekCommencing} />}
    </>
  );
}

import { notFound } from "next/navigation";
import { acknowledgeOneToOne, reopenOneToOne } from "@/app/actions/one-to-ones";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { getSessionProfile } from "@/lib/auth/dal";
import { getOneToOne, getOpenActions, getReviewActions, getSnapshottedKpis, getWeekKpis } from "@/lib/data/one-to-ones";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "1-1 review" };

export default async function OneToOneDetailPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const [detail, profile] = await Promise.all([getOneToOne(reviewId), getSessionProfile()]);
  if (!detail) notFound();
  const [liveKpis, openActions, reviewActions] = await Promise.all([
    getWeekKpis(detail.siteId, detail.weekCommencing),
    getOpenActions(detail.managerId),
    getReviewActions(detail.id),
  ]);
  const lockedKpis = ["finalised", "acknowledged"].includes(detail.status)
    ? getSnapshottedKpis(detail.kpiSnapshot)
    : null;
  const kpis = lockedKpis ?? liveKpis;
  const canManage = profile && ["admin", "group_manager"].includes(profile.role);
  const canAcknowledge = detail.status === "finalised" && (canManage || profile?.id === detail.managerId);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{detail.siteName} · Week commencing {formatDate(detail.weekCommencing)}</p>
          <h1 className="page-header__title">{detail.managerName}.</h1>
          <p className="page-header__copy">
            {detail.status === "acknowledged"
              ? `Finalised and acknowledged${detail.overallScore !== null ? ` · overall ${detail.overallScore.toFixed(1)}` : ""}.`
              : detail.status === "finalised"
                ? "Finalised and locked. The figures shown are the immutable site snapshot captured for this manager and week."
                : "Draft review — scores and actions can still be edited."}
          </p>
        </div>
        <div className="page-header__actions">
          {canAcknowledge && (
            <form action={acknowledgeOneToOne}>
              <input name="reviewId" type="hidden" value={detail.id} />
              <button className="button button--primary" type="submit">Acknowledge review</button>
            </form>
          )}
          {canManage && (detail.status === "finalised" || detail.status === "acknowledged") && (
            <form action={reopenOneToOne} className="reopen-form">
              <input name="reviewId" type="hidden" value={detail.id} />
              <input className="field__input" name="reason" placeholder="Reason to reopen" required />
              <button className="button button--secondary" type="submit">Reopen</button>
            </form>
          )}
        </div>
      </header>
      <OneToOneForm
        assignmentId={detail.assignmentId}
        detail={detail}
        initialActions={reviewActions}
        kpis={kpis}
        managerFirstName={detail.managerName.split(" ")[0]}
        managerName={detail.managerName}
        openActions={openActions}
        weekCommencing={detail.weekCommencing}
      />
    </>
  );
}

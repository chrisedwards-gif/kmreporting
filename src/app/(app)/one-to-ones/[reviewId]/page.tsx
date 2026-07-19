import { notFound } from "next/navigation";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { acknowledgeOneToOne, reopenOneToOne } from "@/app/actions/one-to-ones";
import { getSessionProfile } from "@/lib/auth/dal";
import { getManagers, getOneToOne, getOpenActions, getWeekKpis } from "@/lib/data/one-to-ones";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "1-1 review" };

export default async function OneToOneDetailPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const [detail, profile] = await Promise.all([getOneToOne(reviewId), getSessionProfile()]);
  if (!detail) notFound();
  const managers = await getManagers();
  const manager = managers.find((item) => item.id === detail.managerId);
  const [kpis, openActions] = await Promise.all([
    getWeekKpis(manager?.siteId ?? null, detail.weekCommencing),
    getOpenActions(detail.managerId),
  ]);
  const canManage = profile && ["admin", "group_manager"].includes(profile.role);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{manager?.siteName ?? "Kitchen"} · Week commencing {formatDate(detail.weekCommencing)}</p>
          <h1 className="page-header__title">{detail.managerName}.</h1>
          <p className="page-header__copy">
            {detail.status === "acknowledged"
              ? `Finalised and acknowledged${detail.overallScore !== null ? ` · overall ${detail.overallScore.toFixed(1)}` : ""}.`
              : detail.status === "finalised"
                ? "Finalised and locked. The manager can acknowledge it below."
                : "Draft review — scores and actions can still be edited."}
          </p>
        </div>
        <div className="page-header__actions">
          {detail.status === "finalised" && (
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
        detail={detail}
        kpis={kpis}
        managerFirstName={detail.managerName.split(" ")[0]}
        managerId={detail.managerId}
        managerName={detail.managerName}
        openActions={openActions}
        weekCommencing={detail.weekCommencing}
      />
    </>
  );
}

import { notFound } from "next/navigation";
import { reviewKitchenCheck } from "@/app/actions/kitchen-checks";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { KitchenCheckForm } from "@/components/kitchen-checks/kitchen-check-form";
import { getSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { getKitchenCheckRun } from "@/lib/data/kitchen-checks";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Kitchen check" };

export default async function KitchenCheckDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [detail, profile] = await Promise.all([getKitchenCheckRun(runId), getSessionProfile()]);
  if (!detail || !profile || !scopeContainsSite(profile.siteScopeIds, detail.siteId)) notFound();
  const canReview = profile.capabilities.manageGroup;
  const canEditEvidence = profile.capabilities.maintainTrackers;

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">{detail.siteName} · {detail.cadence} · v{detail.templateVersion}</p><h1 className="page-header__title">{detail.templateName}.</h1><p className="page-header__copy">{formatDate(detail.periodStart)}{detail.periodEnd !== detail.periodStart ? ` – ${formatDate(detail.periodEnd)}` : ""} · {detail.description}</p></div><span className={`status-badge status-badge--${detail.result === "pass" ? "approved" : detail.result === "watch" ? "review_required" : detail.result === "fail" ? "returned" : "draft"}`}>{detail.status.replaceAll("_", " ")} · {detail.result.replaceAll("_", " ")}</span></header>
      <KitchenCheckForm detail={detail} />
      <EvidencePanel canEdit={canEditEvidence} description="Attach close-down photos, compliance evidence or supporting documents to the saved check. These files remain private to the authorised kitchen workspace." entityId={detail.id} entityType="kitchen_check_run" files={detail.evidence} recommendedType="check_photo" title="Check evidence" />
      {canReview && detail.status === "submitted" ? <section className="panel check-review-panel"><div className="panel__header"><div><h2 className="panel__title">Management review</h2><p className="panel__subtitle">Confirm the check and record any follow-up notes</p></div></div><form action={reviewKitchenCheck} className="panel__body report-form"><input name="runId" type="hidden" value={detail.id} /><label className="field"><span className="field__label">Review notes</span><textarea className="field__input" name="notes" rows={3} /></label><button className="button button--primary" type="submit">Mark reviewed</button></form></section> : null}
      {detail.reviewNotes ? <div className="privacy-callout"><strong>Management review:</strong> {detail.reviewNotes}</div> : null}
    </>
  );
}

"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  FileDown,
  FileSignature,
  Gauge,
  History,
  LockKeyhole,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
} from "lucide-react";
import {
  finaliseProbationReview,
  revokeProbationRagOverride,
  saveProbationReview,
  setProbationRagOverride,
  type ProbationActionState,
} from "@/app/actions/probation";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { ActionToast } from "@/components/ui/action-toast";
import type {
  ProbationOutcome,
  ProbationReviewRecord,
  ProbationReviewStage,
  ProbationSummary,
} from "@/lib/data/performance";
import type { Rag } from "@/lib/performance/scoring";
import { formatDate } from "@/lib/utils";

const initialState: ProbationActionState = { status: "idle", message: "" };

const stageLabels: Record<ProbationReviewStage, string> = {
  "30_day": "30-day review",
  "60_day": "60-day review",
  "90_day": "90-day review",
  final: "Final probation review",
  other: "Additional review",
};

const outcomeLabels: Record<ProbationOutcome, string> = {
  pending: "Decision pending",
  pass: "Pass probation",
  extend: "Extend probation",
  fail: "Do not pass probation",
};

const ragLabels: Record<Rag, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
  neutral: "Not enough evidence",
};

function RefreshOnSuccess({ state }: { state: ProbationActionState }) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  return null;
}

function ProbationReviewForm({
  manager,
  review,
}: {
  manager: ProbationSummary;
  review?: ProbationReviewRecord;
}) {
  const [state, action, pending] = useActionState(saveProbationReview, initialState);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="probation-review-editor">
      <form action={action} className="report-form">
        <input name="id" type="hidden" value={review?.id ?? ""} />
        <input name="managerProfileId" type="hidden" value={manager.managerId} />
        <input name="siteId" type="hidden" value={review?.siteId ?? manager.siteId ?? ""} />
        <div className="form-grid form-grid--three">
          <label className="field">
            <span className="field__label">Review date</span>
            <input className="field__input" defaultValue={review?.reviewDate ?? today} name="reviewDate" required type="date" />
          </label>
          <label className="field">
            <span className="field__label">Review stage</span>
            <select className="field__input" defaultValue={review?.reviewStage ?? (manager.stage === "first_30" ? "30_day" : manager.stage === "days_31_60" ? "60_day" : manager.stage === "days_61_90" ? "90_day" : "other")} name="reviewStage">
              {Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Outcome</span>
            <select className="field__input" defaultValue={review?.outcome ?? "pending"} name="outcome">
              {Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field__label">Extension end date</span>
          <input className="field__input" defaultValue={review?.extensionEndDate ?? ""} name="extensionEndDate" type="date" />
          <small className="field__help">Required only when probation is extended.</small>
        </label>
        <label className="field">
          <span className="field__label">Review notes</span>
          <textarea className="field__input" defaultValue={review?.notes ?? ""} name="notes" placeholder="Evidence considered, progress, strengths, concerns and the basis for the decision." rows={6} />
        </label>
        <label className="field">
          <span className="field__label">Required actions / next steps</span>
          <textarea className="field__input" defaultValue={review?.requiredActions ?? ""} name="requiredActions" placeholder="Actions, owners, dates and support. Required for extensions and failed outcomes." rows={5} />
        </label>
        <ActionToast errorTitle="Probation review could not be saved" state={state} successTitle="Probation draft saved" />
        <RefreshOnSuccess state={state} />
        <button className="button button--secondary" disabled={pending} type="submit"><Save aria-hidden="true" size={15} /> {pending ? "Saving…" : "Save draft"}</button>
      </form>
      {review ? (
        <EvidencePanel
          canEdit
          description="Attach signed forms, meeting notes or supporting documents before finalising. The final snapshot records exactly what was attached."
          entityId={review.id}
          entityType="probation_review"
          files={review.evidence}
          recommendedType="signed_document"
          title="Probation evidence"
        />
      ) : <div className="integrity-callout"><FileSignature aria-hidden="true" size={18} /><span>Save the draft first, then reopen it to attach private evidence and finalise the decision.</span></div>}
    </div>
  );
}

function FinaliseReview({ review }: { review: ProbationReviewRecord }) {
  const [state, action, pending] = useActionState(finaliseProbationReview, initialState);
  return (
    <form action={action} className="probation-finalise">
      <input name="reviewId" type="hidden" value={review.id} />
      <ActionToast errorTitle="Probation review could not be finalised" state={state} successTitle="Probation record finalised" />
      <RefreshOnSuccess state={state} />
      <div>
        <strong>Finalise and lock this decision</strong>
        <span>This stores an immutable snapshot of the score, RAG judgement, evidence list, outcome and audit identity.</span>
      </div>
      <button className="button button--primary" disabled={pending} type="submit"><LockKeyhole aria-hidden="true" size={15} /> {pending ? "Finalising…" : "Finalise record"}</button>
    </form>
  );
}

function RagOverrideControls({ manager }: { manager: ProbationSummary }) {
  const [overrideState, overrideAction, overridePending] = useActionState(setProbationRagOverride, initialState);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeProbationRagOverride, initialState);
  return (
    <section className="rag-override">
      <header className="rag-override__header">
        <div><p className="page-header__eyebrow">Management judgement</p><h3>RAG status and audit trail</h3></div>
        <div className="rag-comparison">
          <span>Calculated <strong className={`rag-text rag-text--${manager.calculatedRag}`}>{ragLabels[manager.calculatedRag]}</strong></span>
          <span>Displayed <strong className={`rag-text rag-text--${manager.displayRag}`}>{ragLabels[manager.displayRag]}</strong></span>
        </div>
      </header>
      {manager.activeOverride ? (
        <div className="rag-override__active">
          <ShieldAlert aria-hidden="true" size={18} />
          <div><strong>{ragLabels[manager.activeOverride.overrideRag]} override</strong><p>{manager.activeOverride.reason}</p><small>{manager.activeOverride.createdByName} · {formatDate(manager.activeOverride.createdAt.slice(0, 10))}</small></div>
        </div>
      ) : <p className="rag-override__copy">No management override is active. The displayed status is calculated from the latest finalised 1-1 evidence.</p>}
      <div className="rag-override__forms">
        <form action={overrideAction} className="rag-override__form">
          <input name="managerId" type="hidden" value={manager.managerId} />
          <label className="field field--compact"><span className="field__label">Override status</span><select className="field__input" defaultValue={manager.displayRag === "neutral" ? "amber" : manager.displayRag} name="overrideRag"><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option><option value="neutral">Not enough evidence</option></select></label>
          <label className="field"><span className="field__label">Reason</span><input className="field__input" name="reason" placeholder="Why management judgement differs from the calculated score" required /></label>
          <button className="button button--secondary" disabled={overridePending} type="submit"><Gauge aria-hidden="true" size={15} /> {overridePending ? "Recording…" : manager.activeOverride ? "Replace override" : "Record override"}</button>
        </form>
        {manager.activeOverride ? (
          <form action={revokeAction} className="rag-override__form rag-override__form--revoke">
            <input name="overrideId" type="hidden" value={manager.activeOverride.id} />
            <label className="field"><span className="field__label">Removal reason</span><input className="field__input" name="reason" placeholder="Why the calculated status should become active again" required /></label>
            <button className="button button--quiet" disabled={revokePending} type="submit"><RotateCcw aria-hidden="true" size={15} /> {revokePending ? "Removing…" : "Remove override"}</button>
          </form>
        ) : null}
      </div>
      {manager.overrideHistory.length ? (
        <details className="rag-override__history">
          <summary><History aria-hidden="true" size={14} /> Override history ({manager.overrideHistory.length})</summary>
          <div className="rag-override__timeline">
            {manager.overrideHistory.map((override) => (
              <article key={override.id}>
                <span className={`rag-chip rag-chip--${override.overrideRag}`}>{ragLabels[override.calculatedRag]} → {ragLabels[override.overrideRag]}</span>
                <div><strong>{override.reason}</strong><small>Recorded by {override.createdByName} on {formatDate(override.createdAt.slice(0, 10))}</small>{override.revokedAt ? <small>Removed by {override.revokedByName ?? "Group management"} on {formatDate(override.revokedAt.slice(0, 10))}: {override.revokeReason}</small> : <small>Active</small>}</div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      <ActionToast errorTitle="RAG override could not be recorded" state={overrideState} successTitle="RAG override recorded" />
      <ActionToast errorTitle="RAG override could not be removed" state={revokeState} successTitle="Calculated RAG restored" />
      <RefreshOnSuccess state={overrideState.status === "success" ? overrideState : revokeState} />
    </section>
  );
}

function ReviewRecord({ manager, review }: { manager: ProbationSummary; review: ProbationReviewRecord }) {
  const finalised = review.status === "finalised";
  return (
    <article className={`probation-record${finalised ? " probation-record--finalised" : ""}`}>
      <header className="probation-record__header">
        <div>
          <p className="page-header__eyebrow">{stageLabels[review.reviewStage]}</p>
          <h3>{formatDate(review.reviewDate)} · {outcomeLabels[review.outcome]}</h3>
          <p>{review.siteName}</p>
        </div>
        <span className={`status-badge ${finalised ? "status-badge--approved" : "status-badge--draft"}`}>{finalised ? "Finalised" : "Draft"}</span>
      </header>
      {finalised ? (
        <div className="probation-record__final">
          <div className="probation-record__summary"><div><strong>{review.scoreSnapshot?.toFixed(1) ?? "—"}</strong><span>Score snapshot</span></div><div><strong className={`rag-text rag-text--${review.ragSnapshot ?? "neutral"}`}>{ragLabels[review.ragSnapshot ?? "neutral"]}</strong><span>RAG snapshot</span></div><div><strong>{review.evidence.length}</strong><span>Evidence files</span></div></div>
          <div className="probation-record__narrative"><h4>Review notes</h4><p>{review.notes}</p>{review.requiredActions ? <><h4>Required actions</h4><p>{review.requiredActions}</p></> : null}</div>
          <EvidencePanel canEdit={false} entityId={review.id} entityType="probation_review" files={review.evidence} title="Evidence captured at finalisation" />
          <footer className="probation-record__footer"><span><LockKeyhole aria-hidden="true" size={14} /> Finalised {review.finalisedAt ? formatDate(review.finalisedAt.slice(0, 10)) : ""} by {review.finalisedByName ?? "Group management"}</span><a className="button button--primary" href={`/api/probation/${review.id}/pdf`}><FileDown aria-hidden="true" size={15} /> Download PDF record</a></footer>
        </div>
      ) : (
        <div className="probation-record__draft">
          <ProbationReviewForm manager={manager} review={review} />
          <FinaliseReview review={review} />
        </div>
      )}
    </article>
  );
}

export function ProbationWorkspace({ managers }: { managers: ProbationSummary[] }) {
  return (
    <div className="probation-workspace">
      {managers.map((manager) => (
        <section className="panel probation-manager" key={manager.managerId}>
          <header className="panel__header probation-manager__header">
            <div><p className="page-header__eyebrow">{manager.stageLabel}</p><h2 className="panel__title">{manager.fullName}</h2><p className="panel__subtitle">{manager.roleTitle} · {manager.siteName}</p></div>
            <div className="probation-manager__score"><span className={`score-pill score-pill--${manager.displayRag}`}>{manager.weightedScore?.toFixed(1) ?? "—"}</span><small>{manager.activeOverride ? "Overridden RAG" : "Calculated RAG"}</small></div>
          </header>
          <div className="panel__body">
            <div className="probation-overview">
              <div className="probation-stage"><CalendarClock aria-hidden="true" size={16} /><div><strong>{manager.probationEndDate ? `Probation ends ${formatDate(manager.probationEndDate)}` : manager.stageLabel}</strong><span>{manager.employmentStartDate ? `Started ${formatDate(manager.employmentStartDate)}` : "Set a start date in Manager admin"}</span></div></div>
              <div className="manager-card__stats"><span><strong>{manager.reviewCount}</strong> finalised 1-1s</span><span><strong>{manager.latestReviewDate ? formatDate(manager.latestReviewDate) : "—"}</strong> latest evidence</span><span><strong>{manager.probationReviews.length}</strong> probation records</span></div>
            </div>
            <RagOverrideControls manager={manager} />
            <div className="probation-manager__actions">
              <details className="probation-new-review"><summary><CheckCircle2 aria-hidden="true" size={15} /> Start probation review</summary><ProbationReviewForm manager={manager} /></details>
              <details className="manager-history"><summary><Scale aria-hidden="true" size={14} /> Role weights</summary><div className="weight-grid">{Object.entries(manager.weights).map(([area, weight]) => <div className="weight-grid__row" key={area}><span>{area.replaceAll("_", " ")}</span><strong>{Math.round(weight * 100)}%</strong></div>)}</div></details>
              <Link className="button button--secondary" href={`/one-to-ones?manager=${manager.managerId}`}><History aria-hidden="true" size={15} /> Open 1-1 evidence</Link>
            </div>
            <section className="probation-records"><header><div><p className="page-header__eyebrow">Decision record</p><h3>Probation reviews</h3></div><span>{manager.probationReviews.length}</span></header>{manager.probationReviews.map((review) => <ReviewRecord key={review.id} manager={manager} review={review} />)}{!manager.probationReviews.length ? <div className="empty-inline">No probation decision has been recorded yet.</div> : null}</section>
          </div>
        </section>
      ))}
      {!managers.length ? <section className="panel empty-state"><h2>No manager scorecards yet.</h2><p>Add employment dates in Manager admin and finalise a 1-1 to create the first scorecard.</p></section> : null}
    </div>
  );
}

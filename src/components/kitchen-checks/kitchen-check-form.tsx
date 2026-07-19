"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, Check, Save, Send, ShieldAlert } from "lucide-react";
import { saveKitchenCheck, type KitchenCheckActionState } from "@/app/actions/kitchen-checks";
import type {
  KitchenCheckDetail,
  KitchenCheckRating,
  KitchenCheckResponse,
} from "@/lib/data/kitchen-checks";

const initialState: KitchenCheckActionState = { status: "idle", message: "" };

const ratings: Array<{ value: KitchenCheckRating; label: string; points: number | null }> = [
  { value: "green", label: "Green", points: 2 },
  { value: "amber", label: "Amber", points: 1 },
  { value: "red", label: "Red", points: 0 },
  { value: "na", label: "N/A", points: null },
];

const emptyResponse = (itemId: string, ownerProfileId: string): KitchenCheckResponse => ({
  id: null,
  itemId,
  rating: null,
  points: null,
  notes: "",
  actionText: "",
  ownerProfileId,
  dueDate: "",
  managerActionId: null,
});

export function KitchenCheckForm({ detail }: { detail: KitchenCheckDetail }) {
  const [state, formAction, pending] = useActionState(saveKitchenCheck, initialState);
  const firstOwner = detail.owners[0]?.id ?? "";
  const allItems = detail.sections.flatMap((section) => section.items);
  const responseByItem = new Map(detail.responses.map((response) => [response.itemId, response]));
  const [responses, setResponses] = useState<KitchenCheckResponse[]>(
    allItems.map((item) => responseByItem.get(item.id) ?? emptyResponse(item.id, firstOwner)),
  );
  const editable = detail.status === "draft" || detail.status === "reopened";

  const summary = useMemo(() => {
    let score = 0;
    let max = 0;
    let answered = 0;
    let issues = 0;
    let criticalFail = false;
    for (const item of allItems) {
      const response = responses.find((entry) => entry.itemId === item.id);
      if (response?.rating) answered += 1;
      if (response?.rating !== "na") max += item.maxPoints;
      if (response?.rating === "green") score += 2;
      if (response?.rating === "amber") { score += 1; issues += 1; }
      if (response?.rating === "red") { issues += 1; if (item.critical) criticalFail = true; }
    }
    const percentage = max > 0 ? Math.round((score / max) * 1000) / 10 : 0;
    const result = criticalFail
      ? "fail"
      : answered < allItems.length
        ? "in_progress"
        : percentage >= detail.passThreshold
          ? "pass"
          : percentage >= detail.watchThreshold
            ? "watch"
            : "fail";
    return { score, max, answered, issues, criticalFail, percentage, result };
  }, [allItems, detail.passThreshold, detail.watchThreshold, responses]);

  const updateResponse = (itemId: string, patch: Partial<KitchenCheckResponse>) => {
    setResponses((current) => current.map((response) => response.itemId === itemId ? { ...response, ...patch } : response));
  };

  const payload = JSON.stringify({
    runId: detail.id,
    responses: responses.map((response) => ({
      itemId: response.itemId,
      rating: response.rating ?? "",
      notes: response.notes,
      actionText: response.actionText,
      ownerProfileId: response.ownerProfileId,
      dueDate: response.dueDate,
    })),
  });

  return (
    <form action={formAction} className="check-form">
      <input name="payload" type="hidden" value={payload} />

      <section className={`check-scoreboard check-scoreboard--${summary.result}`}>
        <div><span>Live score</span><strong>{summary.percentage.toFixed(1)}%</strong><small>{summary.score} / {summary.max} points</small></div>
        <div><span>Progress</span><strong>{summary.answered} / {allItems.length}</strong><small>checks rated</small></div>
        <div><span>Issues</span><strong>{summary.issues}</strong><small>Amber or Red</small></div>
        <div><span>Result</span><strong>{summary.result.replaceAll("_", " ")}</strong><small>{summary.criticalFail ? "Critical Red — automatic fail" : `Pass ≥ ${detail.passThreshold}%`}</small></div>
      </section>

      {summary.criticalFail ? (
        <div className="critical-warning"><ShieldAlert aria-hidden="true" size={18} /><strong>Critical failure:</strong> at least one food-safety item is Red. It must be fixed immediately and assigned as an action.</div>
      ) : null}

      {detail.sections.map((section) => {
        let previousSubgroup: string | null = null;
        return (
          <section className="check-section" key={section.id}>
            <header className="check-section__header"><div><p className="page-header__eyebrow">Section {section.sortOrder}</p><h2>{section.title}</h2>{section.description ? <p>{section.description}</p> : null}</div></header>
            <div className="check-items">
              {section.items.map((item) => {
                const response = responses.find((entry) => entry.itemId === item.id) ?? emptyResponse(item.id, firstOwner);
                const showSubgroup = item.subgroup && item.subgroup !== previousSubgroup;
                previousSubgroup = item.subgroup;
                const isIssue = response.rating === "amber" || response.rating === "red";
                return (
                  <div key={item.id}>
                    {showSubgroup ? <h3 className="check-subgroup">{item.subgroup}</h3> : null}
                    <article className={`check-item${item.critical ? " check-item--critical" : ""}${response.rating ? ` check-item--${response.rating}` : ""}`}>
                      <div className="check-item__standard">
                        <div className="check-item__title">{item.critical ? <ShieldAlert aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}<strong>{item.title}</strong>{item.critical ? <span>Critical</span> : null}</div>
                        <p>{item.standard}</p>
                      </div>
                      <div className="check-rating" role="radiogroup" aria-label={`${item.title} rating`}>
                        {ratings.map((rating) => (
                          <button
                            aria-pressed={response.rating === rating.value}
                            className={`check-rating__button check-rating__button--${rating.value}${response.rating === rating.value ? " check-rating__button--selected" : ""}`}
                            disabled={!editable}
                            key={rating.value}
                            onClick={() => updateResponse(item.id, {
                              rating: response.rating === rating.value ? null : rating.value,
                              points: response.rating === rating.value ? null : rating.points,
                            })}
                            type="button"
                          >
                            {rating.label}
                          </button>
                        ))}
                      </div>
                      <label className="field check-item__notes">
                        <span className="field__label">Notes / evidence{isIssue ? " (required)" : ""}</span>
                        <textarea className="field__input" disabled={!editable} onChange={(event) => updateResponse(item.id, { notes: event.target.value })} required={isIssue} rows={2} value={response.notes} />
                      </label>
                      {isIssue ? (
                        <div className="check-action-fields">
                          <div className="check-action-fields__title"><AlertTriangle aria-hidden="true" size={15} /> This finding must become an owned action</div>
                          <label className="field"><span className="field__label">Action required</span><input className="field__input" disabled={!editable} onChange={(event) => updateResponse(item.id, { actionText: event.target.value })} required value={response.actionText} /></label>
                          <label className="field"><span className="field__label">Owner</span><select className="field__input" disabled={!editable} onChange={(event) => updateResponse(item.id, { ownerProfileId: event.target.value })} required value={response.ownerProfileId}><option value="">Choose manager</option>{detail.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
                          <label className="field"><span className="field__label">Deadline</span><input className="field__input" disabled={!editable} onChange={(event) => updateResponse(item.id, { dueDate: event.target.value })} required type="date" value={response.dueDate} /></label>
                        </div>
                      ) : null}
                    </article>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div> : null}

      {editable ? (
        <div className="form-actions form-actions--sticky">
          <div className="form-checklist"><span className={`form-checklist__item ${summary.answered === allItems.length ? "form-checklist__item--done" : ""}`}>{summary.answered}/{allItems.length} rated</span><span className={`form-checklist__item ${summary.issues === 0 || detail.owners.length > 0 ? "form-checklist__item--done" : ""}`}>{summary.issues} actions required</span></div>
          <button className="button button--secondary" disabled={pending} name="intent" type="submit" value="draft"><Save aria-hidden="true" size={16} /> Save draft</button>
          <button className="button button--primary" disabled={pending || summary.answered !== allItems.length} name="intent" type="submit" value="submit"><Send aria-hidden="true" size={16} /> {pending ? "Saving…" : "Submit check"}</button>
        </div>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, ListPlus, Plus, X } from "lucide-react";
import {
  createPerformanceAction,
  type PerformanceActionState,
} from "@/app/actions/performance-actions";
import {
  performanceActionTargetLabel,
  type PerformanceActionTarget,
} from "@/lib/performance/action-targets";

const initialState: PerformanceActionState = { status: "idle", message: "" };

function CreateActionModal({
  onClose,
  targets,
}: {
  onClose: () => void;
  targets: PerformanceActionTarget[];
}) {
  const [selectedKey, setSelectedKey] = useState(() => (
    targets[0] ? `${targets[0].managerId}:${targets[0].siteId}` : ""
  ));
  const [state, action, pending] = useActionState(createPerformanceAction, initialState);
  const titleId = useId();
  const selectedTarget = useMemo(() => (
    targets.find((target) => `${target.managerId}:${target.siteId}` === selectedKey) ?? targets[0]
  ), [selectedKey, targets]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!selectedTarget) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby={titleId} aria-modal="true" className="modal" role="dialog">
        <header className="modal__header">
          <div>
            <p className="page-header__eyebrow">Action Log</p>
            <h2 className="modal__title" id={titleId}>Add an action</h2>
            <p className="modal__copy">Create a standalone action without waiting for the next 1-1.</p>
          </div>
          <button aria-label="Close add action dialog" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" size={19} /></button>
        </header>
        {state.status === "success" ? (
          <div className="modal__success">
            <CheckCircle2 aria-hidden="true" size={34} />
            <h3>Action added</h3>
            <p>{state.message}</p>
            <button className="button button--primary" onClick={onClose} type="button">Done</button>
          </div>
        ) : (
          <form action={action} className="modal__body report-form">
            <input name="managerProfileId" type="hidden" value={selectedTarget.managerId} />
            <input name="siteId" type="hidden" value={selectedTarget.siteId} />
            {targets.length > 1 ? (
              <label className="field">
                <span className="field__label">Manager and kitchen</span>
                <select className="field__input" onChange={(event) => setSelectedKey(event.target.value)} value={selectedKey}>
                  {targets.map((target) => {
                    const key = `${target.managerId}:${target.siteId}`;
                    return <option key={key} value={key}>{performanceActionTargetLabel(target)}</option>;
                  })}
                </select>
              </label>
            ) : (
              <div className="privacy-callout">
                <strong>{selectedTarget.managerName}</strong> · {selectedTarget.siteName}
              </div>
            )}
            <label className="field"><span className="field__label">Action</span><textarea autoFocus className="field__input" maxLength={500} name="action" placeholder="What needs to be done?" required rows={3} /></label>
            <label className="field"><span className="field__label">Success measure</span><input className="field__input" maxLength={500} name="successMeasure" placeholder="What does complete look like?" /></label>
            <div className="form-grid form-grid--three">
              <label className="field"><span className="field__label">Owner</span><input className="field__input" defaultValue={selectedTarget.managerName} maxLength={120} name="owner" required /></label>
              <label className="field"><span className="field__label">Due date</span><input className="field__input" name="dueDate" required type="date" /></label>
              <label className="field"><span className="field__label">Priority</span><select className="field__input" defaultValue="medium" name="priority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            </div>
            {state.status === "error" ? <p className="form-message form-message--error" role="alert">{state.message}</p> : null}
            <footer className="modal__footer">
              <button className="button button--secondary" onClick={onClose} type="button">Cancel</button>
              <button className="button button--primary" disabled={pending} type="submit"><ListPlus aria-hidden="true" size={16} /> {pending ? "Adding…" : "Add action"}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

export function CreateActionForm({ targets }: { targets: PerformanceActionTarget[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="button button--primary" disabled={!targets.length} onClick={() => setOpen(true)} type="button">
        <Plus aria-hidden="true" size={16} /> New action
      </button>
      {open ? <CreateActionModal onClose={() => setOpen(false)} targets={targets} /> : null}
    </>
  );
}

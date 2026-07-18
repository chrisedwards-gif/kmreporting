"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckCircle2, Plus, X } from "lucide-react";
import { createSite, type SiteActionState } from "@/app/actions/sites";

const initialState: SiteActionState = { status: "idle", message: "" };

export function CreateSiteForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createSite, initialState);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="button button--primary" type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" size={16} /> Add kitchen
      </button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section aria-labelledby={titleId} aria-modal="true" className="modal" role="dialog">
            <header className="modal__header">
              <div>
                <p className="page-header__eyebrow">New reporting site</p>
                <h2 className="modal__title" id={titleId}>Add a kitchen</h2>
                <p className="modal__copy">Set the commercial targets now; manager access can be assigned after creation.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close add kitchen dialog"><X aria-hidden="true" size={19} /></button>
            </header>
            {state.status === "success" ? (
              <div className="modal__success">
                <CheckCircle2 aria-hidden="true" size={34} />
                <h3>Kitchen created</h3>
                <p>{state.message}</p>
                <button className="button button--primary" type="button" onClick={() => setOpen(false)}>Done</button>
              </div>
            ) : (
              <form action={formAction} className="modal__body report-form">
                <div className="form-grid">
                  <label className="field field--full"><span className="field__label">Kitchen name</span><input autoFocus className="field__input" name="name" required maxLength={120} placeholder="e.g. House of Social Manchester" /></label>
                  <label className="field field--full"><span className="field__label">Site code</span><input className="field__input field__input--code" name="code" required maxLength={24} placeholder="e.g. HOS-MCR" /><span className="field__hint">Capital letters, numbers and hyphens only.</span></label>
                </div>
                <div className="form-divider"><span>Weekly control targets</span></div>
                <div className="form-grid form-grid--three">
                  <label className="field"><span className="field__label">Food cost</span><div className="input-suffix"><input className="field__input" name="foodCostTarget" type="number" min="0" max="100" step="0.1" defaultValue="30" required /><span>%</span></div></label>
                  <label className="field"><span className="field__label">Labour</span><div className="input-suffix"><input className="field__input" name="labourTarget" type="number" min="0" max="100" step="0.1" defaultValue="32" required /><span>%</span></div></label>
                  <label className="field"><span className="field__label">Waste</span><div className="input-suffix"><input className="field__input" name="wasteTarget" type="number" min="0" max="100" step="0.1" defaultValue="1.2" required /><span>%</span></div></label>
                </div>
                {state.status === "error" ? <p role="alert" className="form-message form-message--error">{state.message}</p> : null}
                <footer className="modal__footer">
                  <button className="button button--secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
                  <button className="button button--primary" disabled={pending} type="submit">{pending ? "Creating…" : "Create kitchen"}</button>
                </footer>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

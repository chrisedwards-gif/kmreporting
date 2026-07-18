"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { createSite, type SiteActionState } from "@/app/actions/sites";

const initialState: SiteActionState = { status: "idle", message: "" };

export function CreateSiteForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createSite, initialState);

  return (
    <>
      <button className="button button--primary" type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" size={16} /> Add kitchen
      </button>
      {open ? (
        <section className="panel" style={{ marginBottom: "1rem", maxWidth: "720px" }} aria-label="Add kitchen">
          <div className="panel__header">
            <div><h2 className="panel__title">Add a kitchen</h2><p className="panel__subtitle">This creates an active reporting site. Manager access is assigned separately.</p></div>
            <button className="button button--secondary" type="button" onClick={() => setOpen(false)} aria-label="Close"><X aria-hidden="true" size={16} /></button>
          </div>
          <form action={formAction} className="report-form">
            <div className="report-form__grid">
              <label className="field"><span>Kitchen name</span><input name="name" required maxLength={120} placeholder="TEST – Training Kitchen" /></label>
              <label className="field"><span>Site code</span><input name="code" required maxLength={24} placeholder="TEST-MCR" style={{ textTransform: "uppercase" }} /></label>
              <label className="field"><span>Food cost target (%)</span><input name="foodCostTarget" type="number" min="0" max="100" step="0.1" defaultValue="30" required /></label>
              <label className="field"><span>Labour target (%)</span><input name="labourTarget" type="number" min="0" max="100" step="0.1" defaultValue="32" required /></label>
              <label className="field"><span>Waste target (%)</span><input name="wasteTarget" type="number" min="0" max="100" step="0.1" defaultValue="1.2" required /></label>
            </div>
            {state.status !== "idle" ? <p role="status" className={state.status === "error" ? "form-message form-message--error" : "form-message"}>{state.message}</p> : null}
            <div className="report-form__actions"><button className="button button--primary" disabled={pending} type="submit">{pending ? "Creating…" : "Create kitchen"}</button></div>
          </form>
        </section>
      ) : null}
    </>
  );
}

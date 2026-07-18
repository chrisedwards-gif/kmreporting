"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckCircle2, MailPlus, Settings2, X } from "lucide-react";
import { assignSiteManager, updateSite, type SiteActionState } from "@/app/actions/sites";

type ManagedSite = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
  managers: Array<{ id: string; fullName: string; email: string }>;
};

const initialState: SiteActionState = { status: "idle", message: "" };

export function ManageSiteForm({ site }: { site: ManagedSite }) {
  const [open, setOpen] = useState(false);
  const [settingsState, settingsAction, settingsPending] = useActionState(updateSite, initialState);
  const [managerState, managerAction, managerPending] = useActionState(assignSiteManager, initialState);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="button button--secondary button--compact" type="button" onClick={() => setOpen(true)}><Settings2 aria-hidden="true" size={14} /> Manage</button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section aria-labelledby={titleId} aria-modal="true" className="modal modal--wide" role="dialog">
            <header className="modal__header">
              <div><p className="page-header__eyebrow">Site configuration</p><h2 className="modal__title" id={titleId}>{site.name}</h2><p className="modal__copy">Update reporting controls and assign kitchen-manager access.</p></div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close site settings"><X aria-hidden="true" size={19} /></button>
            </header>
            <div className="modal__body modal__columns">
              <form action={settingsAction} className="report-form">
                <input name="siteId" type="hidden" value={site.id} />
                <h3 className="form-subtitle">Kitchen settings</h3>
                <div className="form-grid">
                  <label className="field"><span className="field__label">Kitchen name</span><input className="field__input" defaultValue={site.name} name="name" required /></label>
                  <label className="field"><span className="field__label">Site code</span><input className="field__input field__input--code" defaultValue={site.code} name="code" required /></label>
                  <label className="field"><span className="field__label">Food target (%)</span><input className="field__input" defaultValue={site.foodCostTarget} name="foodCostTarget" type="number" min="0" max="100" step="0.1" required /></label>
                  <label className="field"><span className="field__label">Labour target (%)</span><input className="field__input" defaultValue={site.labourTarget} name="labourTarget" type="number" min="0" max="100" step="0.1" required /></label>
                  <label className="field"><span className="field__label">Waste target (%)</span><input className="field__input" defaultValue={site.wasteTarget} name="wasteTarget" type="number" min="0" max="100" step="0.1" required /></label>
                  <label className="field"><span className="field__label">Reporting status</span><select className="field__input" defaultValue={String(site.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select></label>
                </div>
                {settingsState.status !== "idle" ? <p className={`form-message ${settingsState.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{settingsState.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{settingsState.message}</p> : null}
                <button className="button button--primary" disabled={settingsPending} type="submit">{settingsPending ? "Saving…" : "Save settings"}</button>
              </form>
              <div className="manager-access">
                <div><h3 className="form-subtitle">Manager access</h3><p className="form-caption">Managers only see kitchens assigned to them.</p></div>
                <div className="manager-list">
                  {site.managers.length ? site.managers.map((manager) => <div className="manager-chip" key={manager.id}><div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{manager.fullName}</strong><span>{manager.email}</span></div></div>) : <div className="empty-inline empty-inline--compact">No kitchen manager assigned.</div>}
                </div>
                <form action={managerAction} className="report-form">
                  <input name="siteId" type="hidden" value={site.id} />
                  <label className="field"><span className="field__label">Manager name</span><input className="field__input" name="fullName" required /></label>
                  <label className="field"><span className="field__label">Work email</span><input className="field__input" name="email" type="email" autoComplete="email" required /><span className="field__hint">New users receive a secure Supabase invitation.</span></label>
                  {managerState.status !== "idle" ? <p className={`form-message ${managerState.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{managerState.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{managerState.message}</p> : null}
                  <button className="button button--secondary" disabled={managerPending} type="submit"><MailPlus aria-hidden="true" size={15} />{managerPending ? "Assigning…" : "Invite / assign manager"}</button>
                </form>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

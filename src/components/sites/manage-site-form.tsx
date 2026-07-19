"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckCircle2, History, MailPlus, Settings2, UserRoundCheck, X } from "lucide-react";
import { assignSiteManager, updateSite, type SiteActionState } from "@/app/actions/sites";
import { formatDate } from "@/lib/utils";

type SiteManagerSummary = {
  assignmentId: string;
  profileId: string;
  fullName: string;
  email: string;
  startsOn: string;
  endsOn: string | null;
};

type ManagedSite = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
  primaryManager: SiteManagerSummary | null;
  managerHistory: SiteManagerSummary[];
};

const initialState: SiteActionState = { status: "idle", message: "" };

export function ManageSiteForm({
  defaultAssignmentStart,
  site,
}: {
  defaultAssignmentStart: string;
  site: ManagedSite;
}) {
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
              <div><p className="page-header__eyebrow">Site configuration</p><h2 className="modal__title" id={titleId}>{site.name}</h2><p className="modal__copy">Update reporting controls and the dated primary-manager assignment.</p></div>
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
                <div><h3 className="form-subtitle">Primary kitchen manager</h3><p className="form-caption">One canonical login identity controls site access and owns future 1-1s. Previous assignments remain in history.</p></div>

                {site.primaryManager ? (
                  <div className="manager-chip manager-chip--primary">
                    <div className="manager-chip__avatar">{site.primaryManager.fullName.slice(0, 1).toUpperCase()}</div>
                    <div><strong>{site.primaryManager.fullName}</strong><span>{site.primaryManager.email}</span><span>Assigned from {formatDate(site.primaryManager.startsOn)}</span></div>
                    <UserRoundCheck aria-hidden="true" size={18} />
                  </div>
                ) : (
                  <div className="empty-inline empty-inline--compact">No primary manager selected. Existing site access alone does not create a 1-1 owner.</div>
                )}

                {site.managerHistory.length ? (
                  <details className="manager-history">
                    <summary><History aria-hidden="true" size={14} /> Previous managers ({site.managerHistory.length})</summary>
                    <div className="manager-list">
                      {site.managerHistory.map((manager) => (
                        <div className="manager-chip" key={manager.assignmentId}>
                          <div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div>
                          <div><strong>{manager.fullName}</strong><span>{formatDate(manager.startsOn)} – {manager.endsOn ? formatDate(manager.endsOn) : "Current"}</span></div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}

                <form action={managerAction} className="report-form">
                  <input name="siteId" type="hidden" value={site.id} />
                  <label className="field"><span className="field__label">Manager name</span><input className="field__input" defaultValue={site.primaryManager?.fullName ?? ""} name="fullName" required /></label>
                  <label className="field"><span className="field__label">Work email / login</span><input className="field__input" defaultValue={site.primaryManager?.email ?? ""} name="email" type="email" autoComplete="email" required /><span className="field__hint">An existing account is reused by UUID. A new email receives a secure invitation.</span></label>
                  <label className="field"><span className="field__label">Effective from (Sunday)</span><input className="field__input" defaultValue={defaultAssignmentStart} name="effectiveFrom" type="date" required /><span className="field__hint">The previous manager closes on the Saturday before this date. Their reports and 1-1 history are preserved.</span></label>
                  {managerState.status !== "idle" ? <p className={`form-message ${managerState.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{managerState.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{managerState.message}</p> : null}
                  <button className="button button--secondary" disabled={managerPending} type="submit"><MailPlus aria-hidden="true" size={15} />{managerPending ? "Assigning…" : site.primaryManager ? "Replace primary manager" : "Assign primary manager"}</button>
                </form>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

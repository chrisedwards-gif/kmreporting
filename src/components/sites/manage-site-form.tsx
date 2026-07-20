"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { CheckCircle2, History, MailPlus, Settings2, UserRoundCheck, UserRoundPlus, X } from "lucide-react";
import {
  assignSiteManager,
  grantAdditionalSiteAccess,
  removeAdditionalSiteAccess,
  updateSite,
  type SiteActionState,
} from "@/app/actions/sites";
import { formatDate } from "@/lib/utils";

type SiteManagerSummary = {
  assignmentId: string;
  profileId: string;
  fullName: string;
  email: string;
  startsOn: string;
  endsOn: string | null;
};

type AdditionalSiteManager = {
  profileId: string;
  fullName: string;
  email: string;
  canSubmit: boolean;
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
  additionalManagers: AdditionalSiteManager[];
};

const initialState: SiteActionState = { status: "idle", message: "" };

export function ManageSiteForm({ defaultAssignmentStart, site }: { defaultAssignmentStart: string; site: ManagedSite }) {
  const [open, setOpen] = useState(false);
  const [settingsState, settingsAction, settingsPending] = useActionState(updateSite, initialState);
  const [managerState, managerAction, managerPending] = useActionState(assignSiteManager, initialState);
  const [accessState, accessAction, accessPending] = useActionState(grantAdditionalSiteAccess, initialState);
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
              <div><p className="page-header__eyebrow">Site configuration</p><h2 className="modal__title" id={titleId}>{site.name}</h2><p className="modal__copy">Update reporting controls, the primary 1-1 owner and any managers who work across this kitchen.</p></div>
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
                {settingsState.status !== "idle" ? <ActionMessage state={settingsState} /> : null}
                <button className="button button--primary" disabled={settingsPending} type="submit">{settingsPending ? "Saving…" : "Save settings"}</button>
              </form>

              <div className="manager-access stack">
                <div><h3 className="form-subtitle">Primary kitchen manager</h3><p className="form-caption">The primary manager owns the dated 1-1 history. Additional access below lets the same person operate more than one kitchen without changing this primary assignment.</p></div>
                {site.primaryManager ? <ManagerChip manager={site.primaryManager} primary /> : <div className="empty-inline empty-inline--compact">No primary manager selected.</div>}
                {site.managerHistory.length ? <details className="manager-history"><summary><History aria-hidden="true" size={14} /> Previous managers ({site.managerHistory.length})</summary><div className="manager-list">{site.managerHistory.map((manager) => <ManagerChip manager={manager} key={manager.assignmentId} />)}</div></details> : null}
                <form action={managerAction} className="report-form">
                  <input name="siteId" type="hidden" value={site.id} />
                  <label className="field"><span className="field__label">Manager name</span><input className="field__input" defaultValue={site.primaryManager?.fullName ?? ""} name="fullName" required /></label>
                  <label className="field"><span className="field__label">Work email / login</span><input className="field__input" defaultValue={site.primaryManager?.email ?? ""} name="email" type="email" autoComplete="email" required /><span className="field__hint">An existing account is reused by UUID. A new email receives a secure invitation.</span></label>
                  <label className="field"><span className="field__label">Effective from (Sunday)</span><input className="field__input" defaultValue={defaultAssignmentStart} name="effectiveFrom" type="date" required /></label>
                  {managerState.status !== "idle" ? <ActionMessage state={managerState} /> : null}
                  <button className="button button--secondary" disabled={managerPending} type="submit"><MailPlus aria-hidden="true" size={15} />{managerPending ? "Assigning…" : site.primaryManager ? "Replace primary manager" : "Assign primary manager"}</button>
                </form>

                <div className="manager-access__secondary">
                  <div><h3 className="form-subtitle">Additional kitchen access</h3><p className="form-caption">Use this for managers who cover two or more kitchens. They can access reports, checks, SOPs, training and product development for every listed kitchen.</p></div>
                  <div className="manager-list">
                    {site.additionalManagers.map((manager) => (
                      <div className="manager-chip" key={manager.profileId}>
                        <div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div>
                        <div><strong>{manager.fullName}</strong><span>{manager.email}</span><span>{manager.canSubmit ? "Can submit kitchen records" : "Read only"}</span></div>
                        <form action={removeAdditionalSiteAccess}><input name="siteId" type="hidden" value={site.id} /><input name="profileId" type="hidden" value={manager.profileId} /><button className="button button--secondary button--compact" type="submit">Remove</button></form>
                      </div>
                    ))}
                    {!site.additionalManagers.length ? <div className="empty-inline empty-inline--compact">No additional managers currently cover this kitchen.</div> : null}
                  </div>
                  <form action={accessAction} className="report-form">
                    <input name="siteId" type="hidden" value={site.id} />
                    <label className="field"><span className="field__label">Manager name</span><input className="field__input" name="fullName" required /></label>
                    <label className="field"><span className="field__label">Work email / existing login</span><input className="field__input" name="email" type="email" required /></label>
                    {accessState.status !== "idle" ? <ActionMessage state={accessState} /> : null}
                    <button className="button button--secondary" disabled={accessPending} type="submit"><UserRoundPlus aria-hidden="true" size={15} /> {accessPending ? "Adding…" : "Add kitchen access"}</button>
                  </form>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ActionMessage({ state }: { state: SiteActionState }) {
  return <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{state.message}</p>;
}

function ManagerChip({ manager, primary = false }: { manager: SiteManagerSummary; primary?: boolean }) {
  return <div className={`manager-chip${primary ? " manager-chip--primary" : ""}`}><div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{manager.fullName}</strong><span>{manager.email}</span><span>{manager.endsOn ? `${formatDate(manager.startsOn)} – ${formatDate(manager.endsOn)}` : `Assigned from ${formatDate(manager.startsOn)}`}</span></div>{primary ? <UserRoundCheck aria-hidden="true" size={18} /> : null}</div>;
}

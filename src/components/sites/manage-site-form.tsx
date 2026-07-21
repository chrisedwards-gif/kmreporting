"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  History,
  MailPlus,
  RotateCcw,
  Settings2,
  Trash2,
  UserRoundCheck,
  UserRoundPlus,
  X,
} from "lucide-react";
import {
  assignSiteManager,
  grantAdditionalSiteAccess,
  removeAdditionalSiteAccess,
  updateSite,
  type SiteActionState,
} from "@/app/actions/sites";
import { deleteUnusedSite, setSiteLifecycle } from "@/app/actions/site-lifecycle";
import { formatDate } from "@/lib/utils";

export type SiteManagerSummary = {
  assignmentId: string;
  profileId: string;
  fullName: string;
  email: string;
  startsOn: string;
  endsOn: string | null;
};

export type AdditionalSiteManager = {
  profileId: string;
  fullName: string;
  email: string;
  canSubmit: boolean;
};

export type SiteUsageSummary = {
  reports: number;
  dailyRecords: number;
  checks: number;
  peopleRecords: number;
  sops: number;
  training: number;
  products: number;
  messages: number;
  payrollRecords: number;
  totalDependencies: number;
};

export type ManagedSite = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  reportingStartDate: string;
  reportingEndDate: string | null;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
  primaryManager: SiteManagerSummary | null;
  managerHistory: SiteManagerSummary[];
  additionalManagers: AdditionalSiteManager[];
  usage: SiteUsageSummary;
  canDelete: boolean;
};

const initialState: SiteActionState = { status: "idle", message: "" };

export function ManageSiteForm({ defaultAssignmentStart, site }: { defaultAssignmentStart: string; site: ManagedSite }) {
  const [open, setOpen] = useState(false);
  const [settingsState, settingsAction, settingsPending] = useActionState(updateSite, initialState);
  const [managerState, managerAction, managerPending] = useActionState(assignSiteManager, initialState);
  const [accessState, accessAction, accessPending] = useActionState(grantAdditionalSiteAccess, initialState);
  const [lifecycleState, lifecycleAction, lifecyclePending] = useActionState(setSiteLifecycle, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteUnusedSite, initialState);
  const titleId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    if ([settingsState, lifecycleState, deleteState].some((state) => state.status === "success")) router.refresh();
  }, [deleteState, lifecycleState, router, settingsState]);

  return (
    <>
      <button className="button button--secondary button--compact" type="button" onClick={() => setOpen(true)}><Settings2 aria-hidden="true" size={14} /> Manage</button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section aria-labelledby={titleId} aria-modal="true" className="modal modal--wide" role="dialog">
            <header className="modal__header">
              <div><p className="page-header__eyebrow">Kitchen configuration</p><h2 className="modal__title" id={titleId}>{site.name}</h2><p className="modal__copy">Edit the kitchen, control its reporting lifecycle and manage every person who can operate it.</p></div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close site settings"><X aria-hidden="true" size={19} /></button>
            </header>
            <div className="modal__body modal__columns">
              <div className="stack">
                <form action={settingsAction} className="report-form">
                  <input name="siteId" type="hidden" value={site.id} />
                  <input name="active" type="hidden" value={String(site.active)} />
                  <div><h3 className="form-subtitle">Kitchen details</h3><p className="form-caption">Names, codes and targets can be corrected without changing historical reports.</p></div>
                  <div className="form-grid">
                    <label className="field"><span className="field__label">Kitchen name</span><input className="field__input" defaultValue={site.name} name="name" required /></label>
                    <label className="field"><span className="field__label">Site code</span><input className="field__input field__input--code" defaultValue={site.code} name="code" required /></label>
                    <label className="field"><span className="field__label">Food target (%)</span><input className="field__input" defaultValue={site.foodCostTarget} name="foodCostTarget" type="number" min="0" max="100" step="0.1" required /></label>
                    <label className="field"><span className="field__label">Labour target (%)</span><input className="field__input" defaultValue={site.labourTarget} name="labourTarget" type="number" min="0" max="100" step="0.1" required /></label>
                    <label className="field"><span className="field__label">Waste target (%)</span><input className="field__input" defaultValue={site.wasteTarget} name="wasteTarget" type="number" min="0" max="100" step="0.1" required /></label>
                  </div>
                  {settingsState.status !== "idle" ? <ActionMessage state={settingsState} /> : null}
                  <button className="button button--primary" disabled={settingsPending} type="submit">{settingsPending ? "Saving…" : "Save kitchen details"}</button>
                </form>

                <section className="site-lifecycle" aria-labelledby={`${titleId}-lifecycle`}>
                  <div><h3 className="form-subtitle" id={`${titleId}-lifecycle`}>Reporting lifecycle</h3><p className="form-caption">Archiving removes the kitchen from new reports and reminders while preserving every report, check, SOP and 1-1.</p></div>
                  <div className="site-lifecycle__status"><span className={`status-badge status-badge--${site.active ? "approved" : "draft"}`}>{site.active ? "Active" : "Archived"}</span><span>{site.active ? `Reporting since ${formatDate(site.reportingStartDate)}` : `Reporting ended ${site.reportingEndDate ? formatDate(site.reportingEndDate) : "previously"}`}</span></div>
                  <form action={lifecycleAction} className="report-form">
                    <input name="siteId" type="hidden" value={site.id} />
                    <input name="intent" type="hidden" value={site.active ? "archive" : "restore"} />
                    {!site.active ? <label className="field"><span className="field__label">Restore reporting from</span><input className="field__input" defaultValue={defaultAssignmentStart} name="reportingStartDate" type="date" required /><span className="field__hint">Choose the Sunday that starts the first expected week.</span></label> : null}
                    {lifecycleState.status !== "idle" ? <ActionMessage state={lifecycleState} /> : null}
                    <button className={`button ${site.active ? "button--secondary" : "button--primary"}`} disabled={lifecyclePending} type="submit">{site.active ? <Archive aria-hidden="true" size={15} /> : <RotateCcw aria-hidden="true" size={15} />}{lifecyclePending ? "Saving…" : site.active ? "Archive kitchen" : "Restore kitchen"}</button>
                  </form>
                </section>

                <section className="site-danger-zone" aria-labelledby={`${titleId}-delete`}>
                  <div><h3 className="form-subtitle" id={`${titleId}-delete`}>Permanent deletion</h3><p className="form-caption">Only a completely unused, already archived kitchen can be deleted. This prevents cascading deletion of operational history.</p></div>
                  <UsageSummary usage={site.usage} />
                  {site.active ? <p className="form-message">Archive this kitchen before permanent deletion can be considered.</p> : site.canDelete ? (
                    <form action={deleteAction} className="report-form">
                      <input name="siteId" type="hidden" value={site.id} />
                      <label className="field"><span className="field__label">Type {site.code} to confirm</span><input autoComplete="off" className="field__input field__input--code" name="confirmationCode" required /></label>
                      {deleteState.status !== "idle" ? <ActionMessage state={deleteState} /> : null}
                      <button className="button button--danger" disabled={deletePending} type="submit"><Trash2 aria-hidden="true" size={15} />{deletePending ? "Deleting…" : "Permanently delete unused kitchen"}</button>
                    </form>
                  ) : <p className="form-message">This kitchen has linked history. It can be archived and restored, but it cannot be permanently deleted.</p>}
                </section>
              </div>

              <div className="manager-access stack">
                <div><h3 className="form-subtitle">Primary kitchen manager</h3><p className="form-caption">The primary manager owns the dated 1-1 history. Additional access lets the same person operate more than one kitchen.</p></div>
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
                    {site.additionalManagers.map((manager) => <div className="manager-chip" key={manager.profileId}><div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{manager.fullName}</strong><span>{manager.email}</span><span>{manager.canSubmit ? "Can submit kitchen records" : "Read only"}</span></div><form action={removeAdditionalSiteAccess}><input name="siteId" type="hidden" value={site.id} /><input name="profileId" type="hidden" value={manager.profileId} /><button className="button button--secondary button--compact" type="submit">Remove</button></form></div>)}
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

function UsageSummary({ usage }: { usage: SiteUsageSummary }) {
  const populated = [["Reports", usage.reports], ["Daily data", usage.dailyRecords], ["Checks", usage.checks], ["People / 1-1s", usage.peopleRecords], ["SOPs", usage.sops], ["Training", usage.training], ["Products", usage.products], ["Messages", usage.messages], ["Payroll aggregates", usage.payrollRecords]].filter(([, count]) => Number(count) > 0);
  if (!populated.length) return <div className="site-usage site-usage--empty">No linked operational records</div>;
  return <div className="site-usage">{populated.map(([label, count]) => <span key={String(label)}><strong>{count}</strong>{label}</span>)}</div>;
}

function ManagerChip({ manager, primary = false }: { manager: SiteManagerSummary; primary?: boolean }) {
  return <div className={`manager-chip${primary ? " manager-chip--primary" : ""}`}><div className="manager-chip__avatar">{manager.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{manager.fullName}</strong><span>{manager.email}</span><span>{manager.endsOn ? `${formatDate(manager.startsOn)} – ${formatDate(manager.endsOn)}` : `Assigned from ${formatDate(manager.startsOn)}`}</span></div>{primary ? <UserRoundCheck aria-hidden="true" size={18} /> : null}</div>;
}

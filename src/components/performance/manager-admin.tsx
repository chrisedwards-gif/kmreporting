"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Plus, UserRoundCog } from "lucide-react";
import { createManager, updateManager, type ManagerActionState } from "@/app/actions/managers";
import type { ManagerAdminRecord } from "@/lib/data/performance";

const initialState: ManagerActionState = { status: "idle", message: "" };

function StateMessage({ state }: { state: ManagerActionState }) {
  if (state.status === "idle") return null;
  return <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.status === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}{state.message}</p>;
}

export function CreateManagerForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createManager, initialState);
  return (
    <section className="panel">
      <div className="panel__header"><div><h2 className="panel__title">Create manager account</h2><p className="panel__subtitle">One login UUID, then assign the person to a kitchen</p></div><button className="button button--secondary button--compact" onClick={() => setOpen((value) => !value)} type="button"><Plus aria-hidden="true" size={14} /> {open ? "Close" : "New manager"}</button></div>
      {open ? <div className="panel__body"><form action={action} className="report-form"><div className="form-grid form-grid--two"><label className="field"><span className="field__label">Full name</span><input className="field__input" name="fullName" required /></label><label className="field"><span className="field__label">Work email / login</span><input className="field__input" name="email" required type="email" /></label><label className="field"><span className="field__label">Role title</span><input className="field__input" defaultValue="Kitchen Manager" name="roleTitle" required /></label><label className="field"><span className="field__label">Employment start date</span><input className="field__input" name="employmentStartDate" type="date" /></label><label className="field"><span className="field__label">Probation end date</span><input className="field__input" name="probationEndDate" type="date" /></label><label className="field"><span className="field__label">Focus areas</span><textarea className="field__input" name="focusAreas" placeholder="One per line or comma separated" rows={3} /></label></div><StateMessage state={state} /><button className="button button--primary" disabled={pending} type="submit"><UserRoundCog aria-hidden="true" size={16} /> {pending ? "Creating…" : "Create manager & invite"}</button></form></div> : null}
    </section>
  );
}

export function ManagerAdminCards({ managers }: { managers: ManagerAdminRecord[] }) {
  return <div className="manager-grid">{managers.map((manager) => <ManagerAdminCard key={manager.id} manager={manager} />)}</div>;
}

function ManagerAdminCard({ manager }: { manager: ManagerAdminRecord }) {
  const [state, action, pending] = useActionState(updateManager, initialState);
  return (
    <section className="panel manager-card">
      <div className="panel__header"><div><h2 className="panel__title">{manager.fullName}</h2><p className="panel__subtitle">{manager.currentSite ?? "Not assigned to a kitchen"}</p></div><span className={`status-badge status-badge--${manager.active ? "approved" : "draft"}`}>{manager.active ? "Active" : "Inactive"}</span></div>
      <div className="panel__body"><form action={action} className="report-form"><input name="profileId" type="hidden" value={manager.id} /><div className="form-grid form-grid--two"><label className="field"><span className="field__label">Full name</span><input className="field__input" defaultValue={manager.fullName} name="fullName" required /></label><label className="field"><span className="field__label">Email / login</span><input className="field__input" defaultValue={manager.email} name="email" required type="email" /></label><label className="field"><span className="field__label">Role title</span><input className="field__input" defaultValue={manager.roleTitle} name="roleTitle" required /></label><label className="field"><span className="field__label">Account status</span><select className="field__input" defaultValue={String(manager.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select></label><label className="field"><span className="field__label">Employment start</span><input className="field__input" defaultValue={manager.employmentStartDate ?? ""} name="employmentStartDate" type="date" /></label><label className="field"><span className="field__label">Probation end</span><input className="field__input" defaultValue={manager.probationEndDate ?? ""} name="probationEndDate" type="date" /></label></div><label className="field"><span className="field__label">Focus areas</span><textarea className="field__input" defaultValue={manager.focusAreas.join("\n")} name="focusAreas" rows={4} /></label><div className="manager-card__identity">Canonical UUID · {manager.id}</div><StateMessage state={state} /><button className="button button--secondary" disabled={pending} type="submit">{pending ? "Saving…" : "Save manager"}</button></form></div>
    </section>
  );
}

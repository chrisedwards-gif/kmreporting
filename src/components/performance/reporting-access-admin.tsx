"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Eye, Plus } from "lucide-react";
import {
  createReportingViewer,
  updateReportingViewer,
  type ReportingAccessState,
} from "@/app/actions/reporting-access";
import type { ReportingViewerRecord } from "@/lib/data/reporting-access";

const initialState: ReportingAccessState = { status: "idle", message: "" };

function StateMessage({ state }: { state: ReportingAccessState }) {
  if (state.status === "idle") return null;
  return <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.status === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}{state.message}</p>;
}

export function ReportingAccessAdmin({ viewers }: { viewers: ReportingViewerRecord[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createReportingViewer, initialState);
  return (
    <section className="panel">
      <div className="panel__header">
        <div><h2 className="panel__title">Reporting-only access</h2><p className="panel__subtitle">Overview, weekly reports, history and management summaries—no operational editing</p></div>
        <button className="button button--secondary button--compact" onClick={() => setOpen((value) => !value)} type="button"><Plus aria-hidden="true" size={14} /> {open ? "Close" : "New reporting viewer"}</button>
      </div>
      {open ? <div className="panel__body"><form action={action} className="report-form"><div className="form-grid form-grid--two"><label className="field"><span className="field__label">Full name</span><input className="field__input" name="fullName" required /></label><label className="field"><span className="field__label">Work email / login</span><input className="field__input" name="email" required type="email" /></label></div><div className="privacy-callout"><Eye aria-hidden="true" className="privacy-callout__icon" size={15} />This account can view group reporting and historical reports but cannot submit, approve, edit checks, access manager performance, or change settings.</div><StateMessage state={state} /><button className="button button--primary" disabled={pending} type="submit"><Eye aria-hidden="true" size={16} /> {pending ? "Creating…" : "Create viewer & invite"}</button></form></div> : null}
      {viewers.length ? <div className="panel__body"><div className="manager-grid">{viewers.map((viewer) => <ReportingViewerCard key={viewer.id} viewer={viewer} />)}</div></div> : <div className="panel__body"><div className="empty-inline empty-inline--compact">No reporting-only accounts yet.</div></div>}
    </section>
  );
}

function ReportingViewerCard({ viewer }: { viewer: ReportingViewerRecord }) {
  const [state, action, pending] = useActionState(updateReportingViewer, initialState);
  return (
    <section className="panel manager-card">
      <div className="panel__header"><div><h3 className="panel__title">{viewer.fullName}</h3><p className="panel__subtitle">Reporting viewer</p></div><span className={`status-badge status-badge--${viewer.active ? "approved" : "draft"}`}>{viewer.active ? "Active" : "Inactive"}</span></div>
      <div className="panel__body"><form action={action} className="report-form"><input name="profileId" type="hidden" value={viewer.id} /><div className="form-grid form-grid--two"><label className="field"><span className="field__label">Full name</span><input className="field__input" defaultValue={viewer.fullName} name="fullName" required /></label><label className="field"><span className="field__label">Email / login</span><input className="field__input" defaultValue={viewer.email} name="email" required type="email" /></label><label className="field"><span className="field__label">Account status</span><select className="field__input" defaultValue={String(viewer.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select></label></div><div className="manager-card__identity">Canonical UUID · {viewer.id}</div><StateMessage state={state} /><button className="button button--secondary" disabled={pending} type="submit">{pending ? "Saving…" : "Save reporting access"}</button></form></div>
    </section>
  );
}

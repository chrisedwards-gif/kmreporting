"use client";

import { useActionState, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { saveTrainingRecord, type TrackerActionState } from "@/app/actions/trackers";
import type { TrackerSite, TrainingRecord } from "@/lib/data/trackers";
import { isActionOverdue } from "@/lib/performance/scoring";
import { formatDate } from "@/lib/utils";

const initialState: TrackerActionState = { status: "idle", message: "" };
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

function TrainingForm({ editing, onDone, sites }: { editing: TrainingRecord | null; onDone: () => void; sites: TrackerSite[] }) {
  const [state, formAction, pending] = useActionState(async (previous: TrackerActionState, formData: FormData) => {
    const result = await saveTrainingRecord(previous, formData);
    if (result.status === "success") onDone();
    return result;
  }, initialState);
  const [followUp, setFollowUp] = useState(editing?.followUpRequired ?? false);

  return (
    <form action={formAction} className="tracker-form">
      <input name="id" type="hidden" value={editing?.id ?? ""} />
      <div className="form-grid form-grid--three">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={editing?.siteId ?? sites[0]?.id ?? ""} name="siteId" required>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Training date</span><input className="field__input" defaultValue={editing?.trainingDate ?? new Date().toISOString().slice(0, 10)} name="trainingDate" required type="date" /></label>
        <label className="field"><span className="field__label">Team member</span><input className="field__input" defaultValue={editing?.teamMember ?? ""} maxLength={160} name="teamMember" required /></label>
        <label className="field"><span className="field__label">Topic</span><input className="field__input" defaultValue={editing?.topic ?? ""} maxLength={240} name="topic" placeholder="Dough handling, allergen matrix…" required /></label>
        <label className="field"><span className="field__label">Method</span><input className="field__input" defaultValue={editing?.method ?? ""} maxLength={500} name="method" placeholder="Demonstration, observation, tasting…" /></label>
        <label className="field"><span className="field__label">Result</span><input className="field__input" defaultValue={editing?.result ?? ""} maxLength={1200} name="result" placeholder="Competent, needs practice…" /></label>
      </div>
      <div className="tracker-form__toggles">
        <label className="checkbox-field"><input defaultChecked={editing?.followUpRequired ?? false} name="followUpRequired" onChange={(event) => setFollowUp(event.target.checked)} type="checkbox" /> Follow-up required</label>
        {followUp ? <label className="field field--compact"><span className="field__label">Follow-up date</span><input className="field__input" defaultValue={editing?.followUpDate ?? ""} name="followUpDate" required type="date" /></label> : null}
        <label className="checkbox-field"><input defaultChecked={editing?.signedOff ?? false} name="signedOff" type="checkbox" /> Signed off</label>
      </div>
      <label className="field"><span className="field__label">Notes</span><textarea className="field__input" defaultValue={editing?.notes ?? ""} maxLength={8000} name="notes" rows={3} /></label>
      {state.status === "error" ? <div className="form-message form-message--error" role="alert">{state.message}</div> : null}
      <div className="tracker-form__actions"><button className="button button--secondary" onClick={onDone} type="button">Cancel</button><button className="button button--primary" disabled={pending || !sites.length} type="submit">{pending ? "Saving…" : editing ? "Save record" : "Record training"}</button></div>
    </form>
  );
}

export function TrainingTracker({ canEdit, records, sites, weekEnd, weekStart }: { canEdit: boolean; records: TrainingRecord[]; sites: TrackerSite[]; weekEnd: string; weekStart: string }) {
  const [site, setSite] = useState("all");
  const [view, setView] = useState("all");
  const [editing, setEditing] = useState<TrainingRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const thisWeek = records.filter((item) => item.trainingDate >= weekStart && item.trainingDate <= weekEnd).length;
  const outstanding = records.filter((item) => item.followUpRequired && !item.signedOff);
  const overdueFollowUps = outstanding.filter((item) => isActionOverdue(item.followUpDate, "in_progress", today));
  const filtered = useMemo(() => records.filter((item) => {
    const siteMatch = site === "all" || item.siteId === site;
    const viewMatch = view === "all" ||
      (view === "follow_up" && item.followUpRequired && !item.signedOff) ||
      (view === "overdue" && item.followUpRequired && !item.signedOff && isActionOverdue(item.followUpDate, "in_progress", today)) ||
      (view === "signed_off" && item.signedOff);
    return siteMatch && viewMatch;
  }), [records, site, today, view]);

  const exportCsv = () => {
    const rows = [["Kitchen", "Date", "Team member", "Topic", "Method", "Result", "Follow-up required", "Follow-up date", "Signed off", "Signed-off date", "Signed off by", "Notes"], ...filtered.map((item) => [item.siteName, item.trainingDate, item.teamMember, item.topic, item.method, item.result, item.followUpRequired ? "Yes" : "No", item.followUpDate ?? "", item.signedOff ? "Yes" : "No", item.signedOffDate ?? "", item.signedOffByName, item.notes])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `training-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="tracker-stats"><div className="tracker-stats__item"><strong>{thisWeek}</strong><span>trained this week</span></div><div className="tracker-stats__item"><strong>{outstanding.length}</strong><span>follow-ups outstanding</span></div><div className={`tracker-stats__item${overdueFollowUps.length ? " tracker-stats__item--overdue" : ""}`}><strong>{overdueFollowUps.length}</strong><span>follow-ups overdue</span></div></div>
      <div className="performance-filters">
        <label className="field field--compact"><span className="field__label">Kitchen</span><select className="field__input" onChange={(event) => setSite(event.target.value)} value={site}><option value="all">All kitchens</option>{sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="field field--compact"><span className="field__label">View</span><select className="field__input" onChange={(event) => setView(event.target.value)} value={view}><option value="all">All records</option><option value="follow_up">Follow-ups outstanding</option><option value="overdue">Follow-ups overdue</option><option value="signed_off">Signed off</option></select></label>
        <button className="button button--secondary performance-filters__export" onClick={exportCsv} type="button"><Download aria-hidden="true" size={15} /> Export CSV</button>
        {canEdit ? <button className="button button--primary performance-filters__export" onClick={() => { setEditing(null); setAdding(true); }} type="button"><Plus aria-hidden="true" size={15} /> Record training</button> : null}
      </div>
      {(adding || editing) ? <TrainingForm editing={editing} key={editing?.id ?? "new"} onDone={() => { setAdding(false); setEditing(null); }} sites={sites} /> : null}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Kitchen</th><th>Date</th><th>Topic</th><th>Result</th><th>Follow-up</th><th>Signed off</th></tr></thead><tbody>{filtered.map((item) => { const overdue = item.followUpRequired && !item.signedOff && isActionOverdue(item.followUpDate, "in_progress", today); return <tr key={item.id}><td>{canEdit ? <button className="link-button" onClick={() => { setAdding(false); setEditing(item); }} type="button"><strong>{item.teamMember}</strong></button> : <strong>{item.teamMember}</strong>}{item.method ? <div className="data-table__subtext">{item.method}</div> : null}</td><td>{item.siteName}</td><td>{formatDate(item.trainingDate)}</td><td>{item.topic}</td><td>{item.result || "—"}</td><td>{item.followUpRequired ? <span className={`rag-chip rag-chip--${item.signedOff ? "green" : overdue ? "red" : "amber"}`}>{item.signedOff ? "Done" : overdue ? `Overdue · ${formatDate(item.followUpDate ?? "")}` : formatDate(item.followUpDate ?? "")}</span> : "—"}</td><td>{item.signedOff ? <span className="rag-chip rag-chip--green">{item.signedOffDate ? formatDate(item.signedOffDate) : "Yes"}{item.signedOffByName ? ` · ${item.signedOffByName}` : ""}</span> : <span className="rag-chip rag-chip--neutral">Not yet</span>}</td></tr>; })}</tbody></table>{!filtered.length ? <div className="empty-inline">No training records match these filters yet.{canEdit ? " Record the first session to start the log." : ""}</div> : null}</div>
    </>
  );
}

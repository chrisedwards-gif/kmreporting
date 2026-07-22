"use client";

import { useActionState, useMemo, useState } from "react";
import { Download, ExternalLink, Plus } from "lucide-react";
import { saveSop, type TrackerActionState } from "@/app/actions/trackers";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import type { SopRecord, TrackerSite } from "@/lib/data/trackers";
import { formatDate } from "@/lib/utils";

const initialState: TrackerActionState = { status: "idle", message: "" };
const categoryLabels: Record<SopRecord["category"], string> = {
  stock_take: "Stock take", ordering: "Ordering", procure_wizard: "Procure Wizard", waste: "Waste",
  close_down: "Close-down", date_labelling: "Date labelling", allergens: "Allergens",
  pizza_standards: "Pizza standards", prep_lists: "Prep lists", cleaning: "Cleaning",
  product_specifications: "Product specifications", training: "Training", compliance: "Compliance", other: "Other",
};
const statusLabels: Record<SopRecord["status"], string> = {
  not_started: "Not started", draft: "Draft", in_review: "In review", live: "Live", reviewed: "Reviewed", archived: "Archived",
};
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

function SopForm({ editing, onDone, sites }: { editing: SopRecord | null; onDone: () => void; sites: TrackerSite[] }) {
  const [state, formAction, pending] = useActionState(async (previous: TrackerActionState, formData: FormData) => {
    const result = await saveSop(previous, formData);
    if (result.status === "success") onDone();
    return result;
  }, initialState);

  return (
    <form action={formAction} className="tracker-form">
      <input name="id" type="hidden" value={editing?.id ?? ""} />
      <div className="form-grid form-grid--three">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={editing?.siteId ?? sites[0]?.id ?? ""} name="siteId" required>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field"><span className="field__label">SOP title</span><input className="field__input" defaultValue={editing?.title ?? ""} maxLength={180} name="title" required /></label>
        <label className="field"><span className="field__label">Category</span><select className="field__input" defaultValue={editing?.category ?? "close_down"} name="category">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field__label">Owner</span><input className="field__input" defaultValue={editing?.owner ?? ""} maxLength={120} name="owner" required /></label>
        <label className="field"><span className="field__label">Priority</span><select className="field__input" defaultValue={editing?.priority ?? "medium"} name="priority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className="field"><span className="field__label">Status</span><select className="field__input" defaultValue={editing?.status ?? "not_started"} name="status">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field__label">Due date</span><input className="field__input" defaultValue={editing?.dueDate ?? ""} name="dueDate" type="date" /></label>
        <label className="field"><span className="field__label">Next review</span><input className="field__input" defaultValue={editing?.nextReviewDate ?? ""} name="nextReviewDate" type="date" /></label>
        <div className="tracker-version"><span>Current version</span><strong>v{editing?.version ?? 1}</strong><small>{editing ? `Saving creates v${editing.version + 1}` : "First save creates v1"}</small></div>
      </div>
      <label className="field"><span className="field__label">Document link</span><input className="field__input" defaultValue={editing?.documentLink ?? ""} name="documentLink" placeholder="https://…" type="url" /></label>
      <label className="field"><span className="field__label">Notes</span><textarea className="field__input" defaultValue={editing?.notes ?? ""} maxLength={8000} name="notes" rows={3} /></label>
      {state.status === "error" ? <div className="form-message form-message--error" role="alert">{state.message}</div> : null}
      <div className="tracker-form__actions"><button className="button button--secondary" onClick={onDone} type="button">Cancel</button><button className="button button--primary" disabled={pending || !sites.length} type="submit">{pending ? "Saving…" : editing ? "Save new version" : "Add SOP"}</button></div>
    </form>
  );
}

export function SopTracker({ canEdit, sites, sops }: { canEdit: boolean; sites: TrackerSite[]; sops: SopRecord[] }) {
  const [site, setSite] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<SopRecord | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => sops.filter((item) =>
    (site === "all" || item.siteId === site) &&
    (category === "all" || item.category === category) &&
    (status === "all" || (status === "open" ? !["live", "reviewed"].includes(item.status) : item.status === status)),
  ), [category, site, sops, status]);

  const progressBySite = useMemo(() => sites.map((entry) => {
    const records = sops.filter((item) => item.siteId === entry.id);
    return { ...entry, done: records.filter((item) => ["live", "reviewed"].includes(item.status)).length, total: records.length };
  }).filter((entry) => entry.total > 0), [sites, sops]);

  const exportCsv = () => {
    const rows = [["Kitchen", "Title", "Category", "Priority", "Owner", "Status", "Due date", "Next review", "Version", "Document", "Notes"], ...filtered.map((item) => [item.siteName, item.title, categoryLabels[item.category], item.priority, item.owner, statusLabels[item.status], item.dueDate ?? "", item.nextReviewDate ?? "", item.version, item.documentLink, item.notes])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `sop-tracker-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      {progressBySite.length ? <div className="sop-progress">{progressBySite.map((entry) => <div className="sop-progress__site" key={entry.id}><div className="sop-progress__head"><strong>{entry.name}</strong><span>{entry.done}/{entry.total} live or reviewed</span></div><div aria-hidden="true" className="sop-progress__bar"><div className="sop-progress__fill" style={{ width: `${Math.round((entry.done / entry.total) * 100)}%` }} /></div></div>)}</div> : null}
      <div className="performance-filters">
        <label className="field field--compact"><span className="field__label">Kitchen</span><select className="field__input" onChange={(event) => setSite(event.target.value)} value={site}><option value="all">All kitchens</option>{sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="field field--compact"><span className="field__label">Category</span><select className="field__input" onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">All categories</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field field--compact"><span className="field__label">Status</span><select className="field__input" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="open">In progress</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button--secondary performance-filters__export" onClick={exportCsv} type="button"><Download aria-hidden="true" size={15} /> Export CSV</button>
        {canEdit ? <button className="button button--primary performance-filters__export" onClick={() => { setEditing(null); setAdding(true); }} type="button"><Plus aria-hidden="true" size={15} /> Add SOP</button> : null}
      </div>
      {(adding || editing) ? <div className="tracker-editor"><SopForm editing={editing} key={editing?.id ?? "new"} onDone={() => { setAdding(false); setEditing(null); }} sites={sites} />{editing ? <EvidencePanel canEdit={canEdit} description="Attach the controlled SOP file, sign-off or supporting photographs. Stored files are private; the legacy document link can remain for external systems." entityId={editing.id} entityType="sop" files={editing.evidence} recommendedType="signed_document" title="SOP evidence" /> : <div className="privacy-callout">Save the SOP first, then reopen it to attach the controlled document and sign-off evidence.</div>}</div> : null}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>SOP</th><th>Kitchen</th><th>Category</th><th>Owner</th><th>Status</th><th>Due</th><th>Next review</th><th>Document</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{canEdit ? <button className="link-button" onClick={() => { setAdding(false); setEditing(item); }} type="button"><strong>{item.title}</strong></button> : <strong>{item.title}</strong>}<div className="data-table__subtext">v{item.version}{item.priority === "high" ? " · high priority" : ""}</div></td><td>{item.siteName}</td><td>{categoryLabels[item.category]}</td><td>{item.owner}</td><td><span className={`rag-chip rag-chip--${["live", "reviewed"].includes(item.status) ? "green" : item.status === "in_review" ? "amber" : "neutral"}`}>{statusLabels[item.status]}</span></td><td>{item.dueDate ? formatDate(item.dueDate) : "—"}</td><td>{item.nextReviewDate ? formatDate(item.nextReviewDate) : "—"}</td><td>{item.documentLink ? <a className="button button--secondary button--compact" href={item.documentLink} rel="noopener noreferrer" target="_blank">Open SOP <ExternalLink aria-hidden="true" size={14} /></a> : <span className="muted-text">No document linked</span>}</td></tr>)}</tbody></table>{!filtered.length ? <div className="empty-inline">No SOPs match these filters yet.{canEdit ? " Add the first kitchen standard to start the register." : ""}</div> : null}</div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { updateOwnManagerAction } from "@/app/actions/one-to-ones";
import type { PerformanceActionItem } from "@/lib/data/performance";
import { formatDate } from "@/lib/utils";

const csvCell = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function ActionLogTable({ actions, canUpdate }: { actions: PerformanceActionItem[]; canUpdate: boolean }) {
  const [manager, setManager] = useState("all");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("all");
  const managers = useMemo(() => [...new Map(actions.map((item) => [item.managerId, item.managerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [actions]);
  const filtered = useMemo(() => actions.filter((item) => {
    const managerMatch = manager === "all" || item.managerId === manager;
    const statusMatch = status === "all" || (status === "open" && !["complete", "cancelled"].includes(item.status)) || item.status === status;
    const priorityMatch = priority === "all" || item.priority === priority;
    return managerMatch && statusMatch && priorityMatch;
  }), [actions, manager, priority, status]);

  const exportCsv = () => {
    const rows = [
      ["Manager", "Kitchen", "Priority", "Action", "Success measure", "Owner", "Due date", "Status", "Outcome"],
      ...filtered.map((item) => [item.managerName, item.siteName, item.priority, item.action, item.successMeasure, item.owner, item.dueDate ?? "", item.status, item.outcome]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `manager-actions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="performance-filters">
        <label className="field field--compact"><span className="field__label">Manager</span><select className="field__input" onChange={(event) => setManager(event.target.value)} value={manager}><option value="all">All managers</option>{managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="field field--compact"><span className="field__label">Status</span><select className="field__input" onChange={(event) => setStatus(event.target.value)} value={status}><option value="open">Open actions</option><option value="all">All statuses</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option></select></label>
        <label className="field field--compact"><span className="field__label">Priority</span><select className="field__input" onChange={(event) => setPriority(event.target.value)} value={priority}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <button className="button button--secondary performance-filters__export" onClick={exportCsv} type="button"><Download aria-hidden="true" size={15} /> Export CSV</button>
      </div>
      <div className="table-scroll"><table className="data-table action-log-table"><thead><tr><th>Manager</th><th>Action</th><th>Due</th><th>Priority</th><th>Status & outcome</th><th><span className="sr-only">Review</span></th></tr></thead><tbody>
        {filtered.map((item) => <tr key={item.id}><td><strong>{item.managerName}</strong><div className="data-table__subtext">{item.siteName}</div></td><td><strong>{item.action}</strong>{item.successMeasure ? <div className="data-table__subtext">Success: {item.successMeasure}</div> : null}</td><td>{item.dueDate ? formatDate(item.dueDate) : "—"}</td><td><span className={`priority-pill priority-pill--${item.priority}`}>{item.priority}</span></td><td>{canUpdate ? <form action={updateOwnManagerAction} className="action-status-form"><input name="actionId" type="hidden" value={item.id} /><select aria-label={`Status for ${item.action}`} className="field__input field__input--compact" defaultValue={item.status === "cancelled" ? "blocked" : item.status} name="status"><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select><input aria-label={`Outcome for ${item.action}`} className="field__input field__input--compact" defaultValue={item.outcome} name="outcome" placeholder="Progress / outcome" /><button className="button button--secondary button--compact" type="submit">Update</button></form> : <div><strong>{item.status.replaceAll("_", " ")}</strong>{item.outcome ? <div className="data-table__subtext">{item.outcome}</div> : null}</div>}</td><td>{item.reviewId ? <Link aria-label="Open source 1-1" href={`/one-to-ones/${item.reviewId}`}><ExternalLink aria-hidden="true" size={16} /></Link> : "—"}</td></tr>)}
        {!filtered.length ? <tr><td colSpan={6}><div className="empty-inline">No actions match these filters.</div></td></tr> : null}
      </tbody></table></div>
    </>
  );
}

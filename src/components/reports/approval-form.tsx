"use client";

import { useActionState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { processApproval, type ApprovalActionState } from "@/app/actions/approvals";
import type { ReportStatus } from "@/lib/types";

const initialState: ApprovalActionState = { status: "idle", message: "" };

export function ApprovalForm({ reportId, status, hasFlags }: { reportId: string; status: ReportStatus; hasFlags: boolean }) {
  const [state, action, pending] = useActionState(processApproval, initialState);
  const isApproved = status === "approved";
  const isShared = status === "shared";

  if (isShared) return <div className="privacy-callout"><CheckCircle2 aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />This report has been approved and shared.</div>;
  if (isApproved) return <div className="privacy-callout"><LockKeyhole aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />Approved. It will be released with the management summary after every required kitchen is approved.</div>;

  return (
    <form action={action} className="report-form">
      <input name="reportId" type="hidden" value={reportId} />
      <label className="field">
        <span className="field__label">{hasFlags ? "Review resolution & approval notes" : "Approval notes"}</span>
        <textarea className="field__input" name="notes" placeholder={hasFlags ? "Record what you checked and how each exception was resolved…" : "Optional decision note…"} required={hasFlags} />
      </label>
      <button className="button button--primary" disabled={pending} name="intent" type="submit" value="approve">
        <CheckCircle2 aria-hidden="true" size={16} />
        {pending ? "Recording…" : "Resolve & approve"}
      </button>
      {state.status !== "idle" && <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div>}
    </form>
  );
}

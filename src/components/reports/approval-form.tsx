"use client";

import { useActionState } from "react";
import { CheckCircle2, ClipboardCheck, RotateCcw } from "lucide-react";
import { processApproval, shareApprovedReport, type ApprovalActionState } from "@/app/actions/approvals";
import type { ReportStatus } from "@/lib/types";

const initialState: ApprovalActionState = { status: "idle", message: "" };

export function ApprovalForm({ reportId, status, hasFlags }: { reportId: string; status: ReportStatus; hasFlags: boolean }) {
  const [state, action, pending] = useActionState(processApproval, initialState);
  const [shareState, shareAction, sharing] = useActionState(shareApprovedReport, initialState);
  const isApproved = status === "approved";
  const isShared = status === "shared";

  if (isShared) {
    return (
      <div className="privacy-callout">
        <CheckCircle2 aria-hidden="true" className="privacy-callout__icon" size={15} />
        This report is approved and its share has been recorded. This status does not confirm that an email was delivered.
      </div>
    );
  }

  if (isApproved) {
    return (
      <form action={shareAction} className="report-form">
        <input name="reportId" type="hidden" value={reportId} />
        <div className="privacy-callout">
          Approved and ready to distribute. This action records that the report was shared; it does not send an email unless a delivery integration is configured.
        </div>
        <button className="button button--primary" disabled={sharing} type="submit">
          <ClipboardCheck aria-hidden="true" size={16} />
          {sharing ? "Recording…" : "Record report as shared"}
        </button>
        {shareState.status !== "idle" && <div className={`form-message ${shareState.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{shareState.message}</div>}
      </form>
    );
  }

  return (
    <form action={action} className="report-form">
      <input name="reportId" type="hidden" value={reportId} />
      <label className="field">
        <span className="field__label">{hasFlags ? "Review resolution or change request" : "Decision notes"}</span>
        <textarea className="field__input" name="notes" placeholder={hasFlags ? "Record how the exceptions were resolved, or explain exactly what must be corrected…" : "Optional for approval; required when requesting changes…"} required={hasFlags} />
      </label>
      <div className="form-actions">
        <button className="button button--secondary" disabled={pending} name="intent" type="submit" value="changes_requested">
          <RotateCcw aria-hidden="true" size={16} />
          {pending ? "Recording…" : "Request changes"}
        </button>
        <button className="button button--primary" disabled={pending} name="intent" type="submit" value="approve">
          <CheckCircle2 aria-hidden="true" size={16} />
          {pending ? "Recording…" : "Resolve & approve"}
        </button>
      </div>
      {state.status !== "idle" && <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div>}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { sendManagementSummaryTestEmail, type SummaryEmailState } from "@/app/actions/management-summary-email";

const initialState: SummaryEmailState = { status: "idle", message: "" };

export function SummaryEmailTest({ periodId, enabled }: { periodId?: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(sendManagementSummaryTestEmail, initialState);
  if (!enabled) return null;

  return (
    <form action={action} className="summary-actions">
      <input name="periodId" type="hidden" value={periodId} />
      <button className="button button--secondary" disabled={pending || !periodId} type="submit"><MailCheck aria-hidden="true" size={16} />{pending ? "Sending test…" : "Send test to me"}</button>
      {state.status !== "idle" ? <span className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</span> : null}
    </form>
  );
}

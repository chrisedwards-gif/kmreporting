"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Printer, Send, Share2 } from "lucide-react";
import { releaseManagementSummary, type ApprovalActionState } from "@/app/actions/approvals";

const initialState: ApprovalActionState = { status: "idle", message: "" };

export function SummaryControls({ ready, released, periodId, canRelease, hasApprovedReports }: { ready: boolean; released: boolean; periodId?: string; canRelease: boolean; hasApprovedReports: boolean }) {
  const [state, action, pending] = useActionState(releaseManagementSummary, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success" && state.intent !== "partial") router.refresh();
  }, [router, state.intent, state.status]);
  if (!ready && !canRelease) return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for management release</button>;
  if (!ready && !hasApprovedReports) return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for approved reports</button>;
  if (!ready && state.status === "success") return <div className="summary-actions"><button className="button button--secondary" onClick={() => window.print()} type="button"><Printer aria-hidden="true" size={16} /> Print partial update</button><span className="form-message form-message--success" role="status">{state.message}</span></div>;
  if (released || state.status === "success") return <div className="summary-actions"><button className="button button--primary" onClick={() => window.print()} type="button"><Printer aria-hidden="true" size={16} /> Print released summary</button>{state.message ? <span className="form-message form-message--success" role="status">{state.message}</span> : null}</div>;
  if (!canRelease) return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for management release</button>;
  if (!ready) return (
    <form action={action} className="summary-actions">
      <input name="periodId" type="hidden" value={periodId} />
      <button className="button button--secondary" disabled={pending || !periodId} name="intent" type="submit" value="partial"><Send aria-hidden="true" size={16} />{pending ? "Recording…" : "Record partial update"}</button>
      {state.status === "error" ? <span className="form-message form-message--error" role="alert">{state.message}</span> : null}
    </form>
  );
  return (
    <form action={action} className="summary-actions">
      <input name="periodId" type="hidden" value={periodId} />
      <input name="intent" type="hidden" value="complete" />
      <button className="button button--primary" disabled={pending || !periodId} type="submit"><Share2 aria-hidden="true" size={16} />{pending ? "Releasing…" : "Release management summary"}</button>
      {state.status === "error" ? <span className="form-message form-message--error" role="alert">{state.message}</span> : null}
    </form>
  );
}

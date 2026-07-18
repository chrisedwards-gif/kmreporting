"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Printer, Share2 } from "lucide-react";
import { releaseManagementSummary, type ApprovalActionState } from "@/app/actions/approvals";

const initialState: ApprovalActionState = { status: "idle", message: "" };

export function SummaryControls({ ready, released, periodId, canRelease }: { ready: boolean; released: boolean; periodId?: string; canRelease: boolean }) {
  const [state, action, pending] = useActionState(releaseManagementSummary, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  if (!ready) return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for approvals</button>;
  if (released || state.status === "success") return <div className="summary-actions"><button className="button button--primary" onClick={() => window.print()} type="button"><Printer aria-hidden="true" size={16} /> Print released summary</button>{state.message ? <span className="form-message form-message--success" role="status">{state.message}</span> : null}</div>;
  if (!canRelease) return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for management release</button>;
  return (
    <form action={action} className="summary-actions">
      <input name="periodId" type="hidden" value={periodId} />
      <button className="button button--primary" disabled={pending || !periodId} type="submit"><Share2 aria-hidden="true" size={16} />{pending ? "Releasing…" : "Release management summary"}</button>
      {state.status === "error" ? <span className="form-message form-message--error" role="alert">{state.message}</span> : null}
    </form>
  );
}

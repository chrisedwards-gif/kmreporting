"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download, Send, Share2 } from "lucide-react";
import { releaseManagementSummary, type ApprovalActionState } from "@/app/actions/approvals";

const initialState: ApprovalActionState = { status: "idle", message: "" };

export function SummaryControls({
  ready,
  released,
  periodId,
  weekEnd,
  canRelease,
  hasApprovedReports,
}: {
  ready: boolean;
  released: boolean;
  periodId?: string;
  weekEnd: string;
  canRelease: boolean;
  hasApprovedReports: boolean;
}) {
  const [state, action, pending] = useActionState(releaseManagementSummary, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success" && state.intent !== "partial") router.refresh();
  }, [router, state.intent, state.status]);

  const exportPdf = () => {
    const previousTitle = document.title;
    document.title = `HOS Weekly Management Pack - Week Ending ${weekEnd}`;
    window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
    window.print();
  };

  const releaseControl = !canRelease || released || !hasApprovedReports
    ? null
    : ready
      ? (
          <form action={action} className="summary-actions__release">
            <input name="periodId" type="hidden" value={periodId} />
            <input name="intent" type="hidden" value="complete" />
            <button className="button button--primary" disabled={pending || !periodId} type="submit"><Share2 aria-hidden="true" size={16} />{pending ? "Releasing…" : "Release weekly pack"}</button>
          </form>
        )
      : (
          <form action={action} className="summary-actions__release">
            <input name="periodId" type="hidden" value={periodId} />
            <button className="button button--secondary" disabled={pending || !periodId} name="intent" type="submit" value="partial"><Send aria-hidden="true" size={16} />{pending ? "Recording…" : "Record partial update"}</button>
          </form>
        );

  return (
    <div className="summary-actions">
      <button className="button button--primary" disabled={!hasApprovedReports} onClick={exportPdf} type="button"><Download aria-hidden="true" size={16} /> Export PDF</button>
      {releaseControl}
      {state.status === "success" ? <span className="form-message form-message--success" role="status">{state.message}</span> : null}
      {state.status === "error" ? <span className="form-message form-message--error" role="alert">{state.message}</span> : null}
    </div>
  );
}

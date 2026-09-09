"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Save, Send } from "lucide-react";
import { saveWeeklyReport, type ReportActionState } from "@/app/actions/reports";
import { ActionToast } from "@/components/ui/action-toast";
import type { ReportDraftInput } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const initialState: ReportActionState = { status: "idle", message: "" };

export function QuickReportReview({ draft, siteName }: { draft: ReportDraftInput; siteName: string }) {
  const [state, action, pending] = useActionState(saveWeeklyReport, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success" || !state.reportId) return;
    if (state.intent === "submit") router.push(`/reports/${state.reportId}`);
    else router.refresh();
  }, [router, state.intent, state.reportId, state.status]);

  const ready = draft.values.netSales > 0
    && draft.values.staffCost > 0
    && draft.sources.sales.confirmed
    && draft.sources.purchasing.confirmed
    && draft.sources.labour.confirmed;

  return (
    <form action={action} className="quick-report-review">
      <ActionToast errorTitle="Report could not be saved" state={state} successTitle="Weekly report saved" />
      <input name="siteId" type="hidden" value={draft.siteId} />
      <input name="weekStart" type="hidden" value={draft.weekStart} />
      <input name="weekEnd" type="hidden" value={draft.weekEnd} />
      <input name="netSales" type="hidden" value={draft.values.netSales} />
      <input name="openingStock" type="hidden" value={draft.values.openingStock} />
      <input name="purchases" type="hidden" value={draft.values.purchases} />
      <input name="credits" type="hidden" value={draft.values.credits} />
      <input name="transfersIn" type="hidden" value={draft.values.transfersIn} />
      <input name="transfersOut" type="hidden" value={draft.values.transfersOut} />
      <input name="closingStock" type="hidden" value={draft.values.closingStock} />
      <input name="adjustments" type="hidden" value={draft.values.adjustments} />
      <input name="wasteCost" type="hidden" value={draft.values.wasteCost} />
      <input name="staffCost" type="hidden" value={draft.values.staffCost} />
      <input name="paidHours" type="hidden" value={draft.values.paidHours} />
      <input name="pendingCredits" type="hidden" value={draft.values.pendingCredits} />
      <input name="awaitingInvoice" type="hidden" value={draft.values.awaitingInvoice} />
      <input name="stocktakeCompleted" type="hidden" value={String(draft.stocktakeCompleted)} />
      <input name="salesSource" type="hidden" value={draft.sources.sales.mode} />
      <input name="salesSourceReference" type="hidden" value={draft.sources.sales.reference} />
      <input name="salesConfirmed" type="hidden" value={String(draft.sources.sales.confirmed)} />
      <input name="purchasingSource" type="hidden" value={draft.sources.purchasing.mode} />
      <input name="purchasingSourceReference" type="hidden" value={draft.sources.purchasing.reference} />
      <input name="purchasingConfirmed" type="hidden" value={String(draft.sources.purchasing.confirmed)} />
      <input name="labourSource" type="hidden" value={draft.sources.labour.mode} />
      <input name="labourSourceReference" type="hidden" value={draft.sources.labour.reference} />
      <input name="labourConfirmed" type="hidden" value={String(draft.sources.labour.confirmed)} />
      <input name="manualPurchases" type="hidden" value={JSON.stringify(draft.manualPurchases ?? [])} />
      <input name="complianceIssues" type="hidden" value={draft.narrative.complianceIssues} />
      <input name="equipmentIssues" type="hidden" value={draft.narrative.equipmentIssues} />

      <section className="panel quick-report-review__summary">
        <div className="panel__header">
          <div><p className="page-header__eyebrow">Review the numbers</p><h2 className="panel__title">{siteName} · weekly snapshot</h2><p className="panel__subtitle">The source files produced these totals. Correct them in advanced/manual entry only if the export itself is wrong.</p></div>
          <span className={`source-chip ${ready ? "source-chip--safe" : ""}`}>{ready ? <CheckCircle2 aria-hidden="true" size={14} /> : null}{ready ? "Core pack complete" : "Source still missing"}</span>
        </div>
        <div className="quick-report-review__metrics">
          <div><span>Net sales</span><strong>{formatCurrency(draft.values.netSales)}</strong><small>{draft.sources.sales.confirmed ? "EPOS confirmed" : "Needs confirmation"}</small></div>
          <div><span>Food delivered</span><strong>{formatCurrency(Math.max(draft.values.purchases - draft.values.credits, 0))}</strong><small>{draft.sources.purchasing.confirmed ? "Purchasing confirmed" : "Needs confirmation"}</small></div>
          <div><span>Labour</span><strong>{formatCurrency(draft.values.staffCost)}</strong><small>{draft.values.paidHours ? `${draft.values.paidHours.toFixed(1)} paid hours` : draft.sources.labour.confirmed ? "Cost confirmed" : "Needs confirmation"}</small></div>
          <div><span>Pending credits</span><strong>{formatCurrency(draft.values.pendingCredits)}</strong><small>{draft.values.awaitingInvoice ? `${formatCurrency(draft.values.awaitingInvoice)} awaiting invoice` : "No awaiting invoice value"}</small></div>
        </div>
      </section>

      <section className="panel quick-report-review__commentary">
        <div className="panel__header"><div><p className="page-header__eyebrow">Five-minute manager review</p><h2 className="panel__title">What does the data not know?</h2><p className="panel__subtitle">Keep this short. The system already has the numbers; add the operational context needed to explain them.</p></div></div>
        <div className="panel__body quick-report-review__fields">
          <label className="field"><span className="field__label">What went well?</span><textarea className="field__input field__textarea" defaultValue={draft.narrative.wins} maxLength={2000} name="wins" placeholder="Big wins, launch success, service improvements, strong dishes…" /></label>
          <label className="field"><span className="field__label">What changed or caused problems?</span><textarea className="field__input field__textarea" defaultValue={draft.narrative.operationalIssues} maxLength={2000} name="operationalIssues" placeholder="Delivery issue, equipment, unusual event, stock problem, service pressure…" /></label>
          <label className="field"><span className="field__label">People / staffing context</span><textarea className="field__input field__textarea" defaultValue={draft.narrative.staffingIssues} maxLength={2000} name="staffingIssues" placeholder="Absence, training, over/under cover, performance issue…" /></label>
          <label className="field"><span className="field__label">Actions for next week</span><textarea className="field__input field__textarea" defaultValue={draft.narrative.actionsUnderway} maxLength={2000} name="actionsUnderway" placeholder="What are you changing because of this week?" /></label>
          <label className="field"><span className="field__label">Decision or support needed</span><textarea className="field__input field__textarea" defaultValue={draft.narrative.supportNeeded} maxLength={2000} name="supportNeeded" placeholder="Anything the Group Chef / management team needs to decide or unblock?" /></label>
        </div>
      </section>

      <div className="quick-report-review__submit">
        <div><strong>{ready ? "Ready for management review" : "Save the draft and add the missing source before submission."}</strong><span>The source pack, totals and commentary remain attached to this reporting week.</span></div>
        <div className="quick-report-review__buttons">
          <button className="button button--secondary" disabled={pending} name="intent" type="submit" value="draft"><Save aria-hidden="true" size={16} /> Save draft</button>
          <button className="button button--primary" disabled={pending || !ready} name="intent" type="submit" value="submit"><Send aria-hidden="true" size={16} /> {pending ? "Submitting…" : "Submit weekly report"}</button>
        </div>
      </div>
    </form>
  );
}

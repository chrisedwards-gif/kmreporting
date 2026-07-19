"use client";

import { useActionState, useState } from "react";
import { BarChart3, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { saveReportSalesInsights, type SalesInsightActionState } from "@/app/actions/report-sales";
import { parseStockLinkEndOfWeek } from "@/lib/reporting/imports";
import { parseStockLinkSalesInsights } from "@/lib/reporting/sales-imports";
import type { SalesInsightsInput } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const initialState: SalesInsightActionState = { status: "idle", message: "" };
const emptyInsights: SalesInsightsInput = { days: [], items: [], categories: [] };

const readLegacyText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  return new TextDecoder("windows-1252").decode(buffer);
};

export function SalesInsightUpload({
  reportId,
  siteName,
  weekStart,
  weekEnd,
  savedNetSales,
}: {
  reportId: string;
  siteName: string;
  weekStart: string;
  weekEnd: string;
  savedNetSales: number;
}) {
  const [state, action, pending] = useActionState(saveReportSalesInsights, initialState);
  const [insights, setInsights] = useState<SalesInsightsInput>(emptyInsights);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const content = await readLegacyText(file);
      const totals = parseStockLinkEndOfWeek(content, { start: weekStart, end: weekEnd });
      if (totals.siteName.toLowerCase().replace(/[^a-z0-9]/g, "") !== siteName.toLowerCase().replace(/[^a-z0-9]/g, "")) {
        throw new Error(`This export is for ${totals.siteName}, not ${siteName}.`);
      }
      if (Math.abs(totals.netSales - savedNetSales) > Math.max(5, savedNetSales * 0.02)) {
        throw new Error(`The export totals ${formatCurrency(totals.netSales, 2)} net sales, but this report is saved at ${formatCurrency(savedNetSales, 2)}.`);
      }
      const extracted = parseStockLinkSalesInsights(content, { start: weekStart, end: weekEnd }, savedNetSales);
      if (!extracted.days.length && !extracted.items.length && !extracted.categories.length) {
        throw new Error("The headline total was recognised, but this export does not include a readable daily, product or category breakdown.");
      }
      setInsights(extracted);
      setFileName(file.name);
    } catch (caught) {
      setInsights(emptyInsights);
      setFileName("");
      setError(caught instanceof Error ? caught.message : "The EPOS export could not be read.");
    }
  };

  const ready = insights.days.length > 0 || insights.items.length > 0 || insights.categories.length > 0;

  return (
    <section className="panel sales-insight-upload">
      <div className="panel__header"><div><h2 className="panel__title">Detailed EPOS insight</h2><p className="panel__subtitle">Extract daily sales, ATV inputs, available guest metrics and category mix without retaining the raw file</p></div><BarChart3 aria-hidden="true" size={19} /></div>
      <form action={action} className="panel__body report-form">
        <input name="reportId" type="hidden" value={reportId} />
        <input name="payload" type="hidden" value={JSON.stringify(insights)} />
        <label className="source-upload source-upload--wide">
          <Upload aria-hidden="true" size={20} />
          <span><strong>Choose StockLink End of Week export</strong><small>.xls or HTML · the browser extracts safe summaries only</small></span>
          <input accept=".xls,.html" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} type="file" />
        </label>
        {ready ? <div className="sales-import-preview"><FileSpreadsheet aria-hidden="true" size={18} /><div><strong>{fileName}</strong><span>{insights.days.length} daily rows · {insights.items.length} products · {insights.categories.length} categories</span></div></div> : null}
        {error ? <div className="form-message form-message--error" role="alert">{error}</div> : null}
        {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.status === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}{state.message}</div> : null}
        <button className="button button--primary" disabled={!ready || pending} type="submit">{pending ? "Saving insight…" : state.status === "success" ? "Sales insight saved" : "Save sales insight"}</button>
      </form>
    </section>
  );
}

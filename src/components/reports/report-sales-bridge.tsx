"use client";

import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2 } from "lucide-react";
import { normaliseSiteName, parseStockLinkEndOfWeek } from "@/lib/reporting/imports";
import { parseStockLinkSalesInsights } from "@/lib/reporting/sales-imports";

const readLegacyText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  return new TextDecoder("windows-1252").decode(buffer);
};

export function ReportSalesBridge({ sites }: { sites: Array<{ id: string; name: string }> }) {
  const [summary, setSummary] = useState("");

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>("form.report-form");
    const upload = form?.querySelector<HTMLInputElement>('input[type="file"][accept=".xls,.html"]');
    if (!form || !upload) return;

    const removePayload = () => {
      form.querySelector<HTMLInputElement>('input[name="salesInsights"]')?.remove();
      setSummary("");
    };

    const onFormChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (["siteId", "weekStart", "weekEnd"].includes(target.name)) removePayload();
    };

    const onUpload = async () => {
      const file = upload.files?.[0];
      if (!file) return;
      try {
        const content = await readLegacyText(file);
        const siteId = String(new FormData(form).get("siteId") ?? "");
        const weekStart = String(new FormData(form).get("weekStart") ?? "");
        const weekEnd = String(new FormData(form).get("weekEnd") ?? "");
        const selectedSite = sites.find((site) => site.id === siteId);
        const totals = parseStockLinkEndOfWeek(content, { start: weekStart, end: weekEnd });
        if (selectedSite && normaliseSiteName(totals.siteName) !== normaliseSiteName(selectedSite.name)) {
          removePayload();
          return;
        }
        const insights = parseStockLinkSalesInsights(content, { start: weekStart, end: weekEnd }, totals.netSales);
        if (!insights.days.length && !insights.items.length && !insights.categories.length) {
          removePayload();
          return;
        }
        let hidden = form.querySelector<HTMLInputElement>('input[name="salesInsights"]');
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "salesInsights";
          form.append(hidden);
        }
        hidden.value = JSON.stringify(insights);
        const transactions = insights.days.reduce((total, day) => total + day.transactions, 0);
        setSummary(`${insights.days.length} days · ${transactions.toLocaleString("en-GB")} transactions · ${insights.categories.length} categories${insights.items.length ? ` · ${insights.items.length} products` : ""}`);
      } catch {
        removePayload();
      }
    };

    upload.addEventListener("change", onUpload);
    form.addEventListener("change", onFormChange);
    return () => {
      upload.removeEventListener("change", onUpload);
      form.removeEventListener("change", onFormChange);
    };
  }, [sites]);

  if (!summary) return null;
  return <div className="sales-bridge-status"><CheckCircle2 aria-hidden="true" size={16} /><div><strong>Detailed sales insight ready</strong><span>{summary}. It will save with this report; the raw EPOS file will not.</span></div><BarChart3 aria-hidden="true" size={18} /></div>;
}

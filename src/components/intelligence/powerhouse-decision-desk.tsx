"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BadgePoundSterling, Check, Clock3, LoaderCircle, PoundSterling, ShoppingBasket, TrendingDown, TrendingUp, UtensilsCrossed, X } from "lucide-react";
import type { PowerhouseIntelligence, PersistedDecisionSignal } from "@/lib/data/powerhouse-intelligence";
import { formatCurrency } from "@/lib/utils";

const categoryIcon = (category: PersistedDecisionSignal["category"]) => {
  if (category === "labour") return Clock3;
  if (category === "menu") return UtensilsCrossed;
  if (category === "pricing") return BadgePoundSterling;
  if (category === "food_cost" || category === "procurement" || category === "waste") return ShoppingBasket;
  if (category === "reconciliation" || category === "data_quality") return AlertTriangle;
  return TrendingUp;
};

export function PowerhouseDecisionDesk({ intelligence }: { intelligence: PowerhouseIntelligence }) {
  const [signals, setSignals] = useState(intelligence.signals);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visible = signals.filter((signal) => signal.status !== "dismissed");
  const financial = useMemo(() => visible.filter((signal) => signal.status !== "resolved").reduce((sum, signal) => sum + (signal.estimatedWeeklyImpact ?? 0), 0), [visible]);

  const changeStatus = async (signal: PersistedDecisionSignal, intent: "accept" | "dismiss" | "measuring" | "resolved") => {
    if (!signal.recordId || busy) return;
    setBusy(signal.recordId);
    setError("");
    try {
      const response = await fetch("/api/intelligence/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signalId: signal.recordId, intent }) });
      const payload = await response.json().catch(() => ({ error: "The server response could not be read." })) as { ok?: boolean; status?: PersistedDecisionSignal["status"]; error?: string };
      if (!response.ok || !payload.ok || !payload.status) throw new Error(payload.error || "The decision could not be updated.");
      setSignals((current) => current.map((item) => item.recordId === signal.recordId ? { ...item, status: payload.status! } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="powerhouse-desk">
      <div className="decision-desk__hero">
        <div><p className="page-header__eyebrow">Money-saving decision engine</p><h2>{visible.length ? "Ranked actions, not dashboard noise." : "No decision has met the evidence threshold yet."}</h2><p>Every recommendation below is calculated from stored source data. Accepting one turns it into a measurable Action Log item; dismissing it keeps the audit trail without cluttering the live desk.</p></div>
        <div className="decision-desk__score"><span>Indicative surfaced value</span><strong>{financial > 0 ? formatCurrency(financial) : "Building"}</strong><small>weekly opportunity represented by open tests/gaps — not guaranteed savings</small></div>
      </div>
      {error ? <div className="form-message form-message--error" role="alert">{error}</div> : null}
      <div className="powerhouse-desk__filters">
        <span>{visible.filter((signal) => signal.status === "open").length} open</span><span>{visible.filter((signal) => signal.status === "accepted").length} accepted</span><span>{visible.filter((signal) => signal.status === "measuring").length} measuring</span><span>{visible.filter((signal) => signal.status === "resolved").length} resolved</span>
      </div>
      <div className="decision-desk__grid decision-desk__grid--full">
        {visible.map((signal) => {
          const Icon = categoryIcon(signal.category);
          const loading = busy === signal.recordId;
          return (
            <article className={`decision-card decision-card--${signal.severity} decision-card--status-${signal.status}`} key={`${signal.siteId}-${signal.key}`}>
              <div className="decision-card__top"><span className="decision-card__icon"><Icon aria-hidden="true" size={16} /></span><div className="decision-card__labels"><span>{signal.siteName}</span><span>{signal.category.replaceAll("_", " ")}</span></div><span className="decision-card__confidence">{signal.confidence}% confidence</span></div>
              <h3>{signal.title}</h3>
              <p className="decision-card__finding">{signal.finding}</p>
              <div className="decision-card__recommendation"><ArrowRight aria-hidden="true" size={14} /><span>{signal.recommendation}</span></div>
              <div className="decision-card__footer"><span>{signal.severity === "risk" ? <TrendingDown size={13} /> : signal.severity === "opportunity" ? <TrendingUp size={13} /> : <AlertTriangle size={13} />}{signal.severity}</span>{signal.estimatedWeeklyImpact != null ? <strong><PoundSterling size={13} /> {formatCurrency(signal.estimatedWeeklyImpact)}/wk indicated</strong> : <strong>Evidence-led review</strong>}</div>
              <details className="decision-card__evidence"><summary>Evidence</summary><ul>{signal.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>
              <div className="decision-card__actions">
                {signal.status === "open" ? <><button className="button button--primary button--compact" disabled={!signal.recordId || loading} onClick={() => void changeStatus(signal, "accept")} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Accept → Action Log</button><button className="button button--ghost button--compact" disabled={!signal.recordId || loading} onClick={() => void changeStatus(signal, "dismiss")} type="button"><X size={14} /> Dismiss</button></> : null}
                {signal.status === "accepted" ? <><button className="button button--secondary button--compact" disabled={loading} onClick={() => void changeStatus(signal, "measuring")} type="button">Start measuring</button><Link className="button button--ghost button--compact" href="/performance/actions">Open Action Log</Link></> : null}
                {signal.status === "measuring" ? <><button className="button button--primary button--compact" disabled={loading} onClick={() => void changeStatus(signal, "resolved")} type="button"><Check size={14} /> Mark measured/resolved</button><Link className="button button--ghost button--compact" href="/performance/actions">Update outcome</Link></> : null}
                {signal.status === "resolved" ? <span className="source-chip source-chip--safe"><Check size={13} /> Resolved</span> : null}
              </div>
            </article>
          );
        })}
      </div>
      <div className="decision-desk__coverage"><span>{intelligence.dataCoverage.sites} kitchens</span><span>{intelligence.dataCoverage.reportWeeks} weekly snapshots</span><span>{intelligence.dataCoverage.productRows} product rows</span><span>{intelligence.dataCoverage.menuCostRows} menu costs</span><span>{intelligence.dataCoverage.hourlySalesRows} hourly EPOS rows</span><span>{intelligence.dataCoverage.hourlyLabourRows} hourly labour rows</span><span>{intelligence.dataCoverage.reconciliationRows} master checks</span></div>
    </section>
  );
}

import { AlertTriangle, ArrowRight, BadgePoundSterling, BrainCircuit, CheckCircle2, Clock3, PoundSterling, ShoppingBasket, TrendingDown, TrendingUp, UtensilsCrossed } from "lucide-react";
import type { DecisionIntelligence } from "@/lib/data/decision-intelligence";
import type { DecisionSignal } from "@/lib/reporting/decision-engine";
import { formatCurrency } from "@/lib/utils";

const categoryIcon = (category: DecisionSignal["category"]) => {
  if (category === "labour") return Clock3;
  if (category === "menu") return UtensilsCrossed;
  if (category === "pricing") return BadgePoundSterling;
  if (category === "food_cost" || category === "procurement" || category === "waste") return ShoppingBasket;
  if (category === "reconciliation" || category === "data_quality") return AlertTriangle;
  return TrendingUp;
};

export function DecisionDesk({ intelligence, groupView }: { intelligence: DecisionIntelligence; groupView: boolean }) {
  const signals = intelligence.signals.slice(0, groupView ? 8 : 6);
  const financialOpportunity = signals.reduce((sum, signal) => sum + (signal.estimatedWeeklyImpact ?? 0), 0);

  return (
    <section className="decision-desk" aria-label="Decision intelligence">
      <div className="decision-desk__hero">
        <div>
          <p className="page-header__eyebrow">Decision intelligence</p>
          <h2>{signals.length ? "What the data says to do next." : "The decision engine is waiting for enough history."}</h2>
          <p>{signals.length
            ? "These are calculated from uploaded source data and history. AI can explain them later, but it does not create the numbers or evidence."
            : "Upload weekly source packs consistently. Product, hourly demand and labour recommendations become stronger as repeated weeks accumulate."}</p>
        </div>
        <div className="decision-desk__score">
          <span>Observed opportunity</span>
          <strong>{financialOpportunity > 0 ? formatCurrency(financialOpportunity) : "Building"}</strong>
          <small>{financialOpportunity > 0 ? "weekly value represented by surfaced gaps/tests — not guaranteed savings" : `${intelligence.dataCoverage.reportWeeks} report weeks · ${intelligence.dataCoverage.hourlySalesRows} hourly sales rows`}</small>
        </div>
      </div>

      {signals.length ? (
        <div className="decision-desk__grid">
          {signals.map((signal) => <DecisionCard key={`${signal.siteId}-${signal.key}`} signal={signal} groupView={groupView} />)}
        </div>
      ) : (
        <div className="decision-desk__empty">
          <BrainCircuit aria-hidden="true" size={24} />
          <div><strong>No forced conclusions.</strong><span>The engine will not invent recommendations from insufficient evidence.</span></div>
        </div>
      )}

      <div className="decision-desk__coverage">
        <span><CheckCircle2 aria-hidden="true" size={13} /> {intelligence.dataCoverage.sites} kitchens</span>
        <span>{intelligence.dataCoverage.reportWeeks} weekly snapshots</span>
        <span>{intelligence.dataCoverage.productRows} product rows</span>
        <span>{intelligence.dataCoverage.hourlySalesRows} hourly sales rows</span>
        <span>{intelligence.dataCoverage.labourDays} labour days</span>
      </div>
    </section>
  );
}

function DecisionCard({ signal, groupView }: { signal: DecisionSignal; groupView: boolean }) {
  const Icon = categoryIcon(signal.category);
  const confidenceTone = signal.confidence >= 80 ? "high" : signal.confidence >= 65 ? "medium" : "developing";
  return (
    <article className={`decision-card decision-card--${signal.severity}`}>
      <div className="decision-card__top">
        <span className="decision-card__icon"><Icon aria-hidden="true" size={16} /></span>
        <div className="decision-card__labels">
          {groupView ? <span>{signal.siteName}</span> : null}
          <span>{signal.category.replaceAll("_", " ")}</span>
        </div>
        <span className={`decision-card__confidence decision-card__confidence--${confidenceTone}`}>{signal.confidence}% confidence</span>
      </div>
      <h3>{signal.title}</h3>
      <p className="decision-card__finding">{signal.finding}</p>
      <div className="decision-card__recommendation"><ArrowRight aria-hidden="true" size={14} /><span>{signal.recommendation}</span></div>
      <div className="decision-card__footer">
        <span>{signal.severity === "risk" ? <TrendingDown aria-hidden="true" size={13} /> : signal.severity === "opportunity" ? <TrendingUp aria-hidden="true" size={13} /> : <AlertTriangle aria-hidden="true" size={13} />}{signal.severity}</span>
        {signal.estimatedWeeklyImpact != null ? <strong><PoundSterling aria-hidden="true" size={13} /> {formatCurrency(signal.estimatedWeeklyImpact)}/wk indicated</strong> : <strong>Evidence-led review</strong>}
      </div>
      <details className="decision-card__evidence"><summary>Why this was flagged</summary><ul>{signal.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></details>
    </article>
  );
}

"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  LoaderCircle,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { suggestBreaks } from "@/lib/rota/breaks";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-copilot.css";

type StaffTarget = {
  id: string;
  name: string;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
};

type Props = {
  plan: StoredRotaPlan;
  signals: ExternalRotaSignals;
  staffTargets: StaffTarget[];
  initialReview: string | null;
};

type Exchange = { question: string; answer: string };

const timeLabel = (value: string) => value.slice(11, 16);

export function RotaCopilot({ plan, signals, staffTargets, initialReview }: Props) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  const intelligence = useMemo(() => {
    const shifts = plan.days.flatMap((day) => day.shifts);
    const unfilled = shifts.filter((shift) => !shift.staffProfileId);
    const shortShifts = shifts.filter((shift) => shift.staffProfileId && shift.paidMinutes < 360);
    const underCover = plan.days
      .flatMap((day) => day.coverage.map((slot) => ({ ...slot, date: day.businessDate })))
      .filter((slot) => slot.assigned < slot.required);
    const labourPct = plan.forecastSales > 0 ? plan.plannedCost / plan.forecastSales * 100 : 0;
    const staffHours = staffTargets.map((staff) => ({
      ...staff,
      plannedHours: shifts
        .filter((shift) => shift.staffProfileId === staff.id)
        .reduce((sum, shift) => sum + shift.paidMinutes / 60, 0),
    }));
    const belowMinimum = staffHours.filter((staff) => staff.plannedHours + 0.01 < staff.minimumHours);
    const aboveMaximum = staffHours.filter((staff) => staff.plannedHours > staff.maximumHours + 0.01);
    const belowTarget = staffHours.filter((staff) => staff.plannedHours + 2 < staff.targetHours);
    const targetShortfall = staffHours.reduce(
      (sum, staff) => sum + Math.max(0, staff.targetHours - staff.plannedHours),
      0,
    );
    const breaks = plan.days.flatMap((day) => suggestBreaks(day));
    const unsafeBreaks = breaks.filter((item) => item.minutes > 0 && !item.startTime);
    const heavyRain = signals.weather.filter((day) => (day.precipitationMm ?? 0) >= 8);

    let score = 100;
    score -= Math.min(25, unfilled.length * 8);
    score -= Math.min(25, underCover.length * 3);
    score -= Math.min(18, belowMinimum.length * 6);
    score -= Math.min(18, aboveMaximum.length * 9);
    score -= Math.min(12, shortShifts.length * 3);
    score -= Math.min(8, unsafeBreaks.length * 2);
    score -= Math.min(10, Math.floor(targetShortfall / 8));
    if (labourPct > plan.labourTargetPct) {
      score -= Math.min(15, Math.ceil((labourPct - plan.labourTargetPct) * 3));
    }
    score = Math.max(0, Math.round(score));

    const strengths: string[] = [];
    if (labourPct <= plan.labourTargetPct) strengths.push(`Visible labour is within the ${plan.labourTargetPct.toFixed(1)}% allowance.`);
    if (!belowMinimum.length) strengths.push("Every team member meets their configured minimum hours.");
    if (!aboveMaximum.length) strengths.push("No one exceeds their configured maximum hours.");
    if (!underCover.length) strengths.push("Every modelled time slot meets required cover.");
    if (!unsafeBreaks.length) strengths.push("Breaks have a suggested low-risk window.");
    if (!unfilled.length) strengths.push("Every shift in the saved draft has an assigned team member.");

    const risks: string[] = [];
    if (underCover.length) {
      const first = underCover[0];
      risks.push(`${formatDate(first.date)} at ${first.slotTime} is ${first.required - first.assigned} person short of required cover.`);
    }
    belowMinimum.slice(0, 2).forEach((staff) => risks.push(`${staff.name} is ${(staff.minimumHours - staff.plannedHours).toFixed(1)}h below minimum hours.`));
    aboveMaximum.slice(0, 2).forEach((staff) => risks.push(`${staff.name} is ${(staff.plannedHours - staff.maximumHours).toFixed(1)}h above maximum hours.`));
    if (targetShortfall >= 12 && !belowMinimum.length) risks.push(`The team is ${targetShortfall.toFixed(1)}h below combined target hours, even though minimums may be met.`);
    if (shortShifts.length) risks.push(`${shortShifts.length} shift${shortShifts.length === 1 ? " is" : "s are"} under six paid hours.`);
    if (labourPct > plan.labourTargetPct) risks.push(`Visible labour is ${(labourPct - plan.labourTargetPct).toFixed(1)} points above allowance.`);
    if (heavyRain.length) risks.push(`${formatDate(heavyRain[0].date)} has heavy-rain risk; delivery demand may differ from walk-in demand.`);
    if (signals.events.length) risks.push(`${signals.events.length} nearby event${signals.events.length === 1 ? " is" : "s are"} loaded for manager review.`);

    const recommendations: string[] = [];
    if (underCover.length) recommendations.push(`Fix the ${formatDate(underCover[0].date)} ${underCover[0].slotTime} cover gap before reducing another shift.`);
    if (belowMinimum.length) recommendations.push(`Add genuine demand-led hours for ${belowMinimum[0].name}, rather than creating a standalone short shift.`);
    else if (belowTarget.length && targetShortfall >= 12) recommendations.push(`Review whether ${belowTarget[0].name} can take useful peak or prep hours toward target.`);
    if (shortShifts.length) recommendations.push("Extend, combine or explicitly justify each sub-six-hour shift.");
    if (labourPct > plan.labourTargetPct && !underCover.length) recommendations.push(`Review low-demand overlap to remove about ${formatCurrency(Math.max(0, plan.plannedCost - plan.labourBudget))} without weakening cover.`);
    if (unsafeBreaks.length) recommendations.push("Place the breaks with no safe suggested window and recheck live cover.");
    if (!recommendations.length) recommendations.push("Stress-test the busiest day at +15% sales before approving the week.");

    return {
      score,
      labourPct,
      staffHours,
      strengths: strengths.slice(0, 5),
      risks: risks.slice(0, 5),
      recommendations: recommendations.slice(0, 4),
      underCover,
      belowMinimum,
      belowTarget,
    };
  }, [plan, signals, staffTargets]);

  const suggestedQuestions = useMemo(() => {
    const questions = [
      "What is the biggest risk in this saved draft?",
      "What happens if sales are 15% higher?",
      "Where can I reduce labour without weakening cover?",
    ];
    const firstGap = intelligence.underCover[0];
    if (firstGap) questions.push(`How should I fix the ${formatDate(firstGap.date)} ${firstGap.slotTime} cover gap?`);
    const hoursPerson = intelligence.belowMinimum[0] ?? intelligence.belowTarget[0];
    if (hoursPerson) questions.push(`Where can I add useful hours for ${hoursPerson.name}?`);
    else questions.push("Are the breaks and skill mix sensible?");
    return questions.slice(0, 5);
  }, [intelligence]);

  const safeContext = useMemo(() => ({
    weekStart: plan.weekStart,
    forecastSales: plan.forecastSales,
    forecastRange: [plan.forecastLow, plan.forecastHigh] as [number, number],
    labourTargetPct: plan.labourTargetPct,
    labourBudget: plan.labourBudget,
    plannedCost: plan.plannedCost,
    plannedHours: plan.plannedHours,
    confidence: plan.confidence,
    warnings: plan.warnings,
    days: plan.days.map((day) => {
      const breakSuggestions = suggestBreaks(day);
      return {
        date: day.businessDate,
        forecastSales: day.forecastSales,
        labourBudget: day.labourBudget,
        plannedCost: day.plannedCost,
        plannedHours: day.plannedHours,
        peakTime: day.peakTime,
        coverageShortfalls: day.coverage
          .filter((slot) => slot.assigned < slot.required)
          .map((slot) => ({ time: slot.slotTime, assigned: slot.assigned, required: slot.required })),
        shifts: day.shifts.map((shift, index) => {
          const suggestedBreak = breakSuggestions.find((item) => item.shiftIndex === index);
          return {
            staffName: shift.staffName,
            role: shift.roleTitle,
            start: timeLabel(shift.shiftStart),
            end: timeLabel(shift.shiftEnd),
            paidHours: shift.paidMinutes / 60,
            requiredSkill: shift.requiredSkill ?? null,
            suggestedBreak: suggestedBreak?.startTime && suggestedBreak.endTime
              ? `${suggestedBreak.startTime}-${suggestedBreak.endTime}`
              : null,
          };
        }),
      };
    }),
    staffHours: intelligence.staffHours.map((staff) => ({
      name: staff.name,
      minimumHours: staff.minimumHours,
      targetHours: staff.targetHours,
      maximumHours: staff.maximumHours,
      plannedHours: staff.plannedHours,
    })),
    weather: signals.weather,
    nearbyEvents: signals.events,
  }), [intelligence.staffHours, plan, signals]);

  const ask = async (nextQuestion: string) => {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 3 || asking) return;
    setQuestion(trimmed);
    setAsking(true);
    setError(null);
    try {
      const response = await fetch("/api/rotas/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, context: safeContext }),
      });
      const payload = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || "The copilot could not answer.");
      setExchanges((current) => [...current, { question: trimmed, answer: payload.answer! }]);
      setQuestion("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The copilot could not answer.");
    } finally {
      setAsking(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <section aria-labelledby="operations-intelligence-title" className="operations-intelligence panel">
      <header className="operations-intelligence__header">
        <div className="operations-intelligence__score" aria-label={`Rota score ${intelligence.score} out of 100`}>
          <span>{intelligence.score}</span><small>/100</small>
        </div>
        <div>
          <p className="page-header__eyebrow">Saved rota score</p>
          <h2 id="operations-intelligence-title">Management review before you build or approve</h2>
          <p>Save changes in the grid to refresh this score. Cover, cost, shift length and agreed hours are hard checks; AI explains and challenges the saved draft.</p>
        </div>
        <span className={`operations-intelligence__status operations-intelligence__status--${intelligence.score >= 85 ? "good" : intelligence.score >= 65 ? "watch" : "risk"}`}>
          {intelligence.score >= 85 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {intelligence.score >= 85 ? "Strong saved draft" : intelligence.score >= 65 ? "Manager changes needed" : "Not ready to approve"}
        </span>
      </header>

      <div className="operations-intelligence__grid">
        <InsightColumn icon={ShieldCheck} items={intelligence.strengths} title="Strengths" empty="No clear strength can be confirmed yet." />
        <InsightColumn icon={AlertTriangle} items={intelligence.risks} title="Warnings" empty="No material rota warning is currently detected." tone="risk" />
        <InsightColumn icon={ArrowRight} items={intelligence.recommendations} title="Next actions" empty="No action is recommended." tone="action" />
      </div>

      <div className="operations-intelligence__facts">
        <span><Gauge size={16} /><strong>{intelligence.labourPct.toFixed(1)}%</strong> visible labour</span>
        <span><CircleDollarSign size={16} /><strong>{formatCurrency(plan.plannedCost)}</strong> visible cost</span>
        <span><UsersRound size={16} /><strong>{plan.plannedHours.toFixed(1)}h</strong> paid hours</span>
        <span><Sparkles size={16} /><strong>{signals.events.length}</strong> nearby events</span>
      </div>

      {initialReview ? (
        <details className="operations-intelligence__deep-review">
          <summary><BrainCircuit size={17} /> Read the generated management review</summary>
          <p>{initialReview}</p>
        </details>
      ) : null}

      <section className="rota-copilot" aria-labelledby="rota-copilot-title">
        <div className="rota-copilot__heading">
          <div><MessageSquareText size={19} /><span><strong id="rota-copilot-title">Ask the rota copilot</strong><small>Scenario advice grounded in the latest saved manager draft</small></span></div>
          <span className="rota-copilot__privacy">No individual pay data sent</span>
        </div>

        <div className="rota-copilot__suggestions">
          {suggestedQuestions.map((item) => <button disabled={asking} key={item} onClick={() => void ask(item)} type="button">{item}</button>)}
        </div>

        {exchanges.length ? <div className="rota-copilot__conversation">{exchanges.map((exchange, index) => <article key={`${exchange.question}-${index}`}><strong>{exchange.question}</strong><p>{exchange.answer}</p></article>)}</div> : null}

        <form className="rota-copilot__form" onSubmit={submit}>
          <label htmlFor="rota-copilot-question">Ask about hours, cover, cost, breaks or a what-if scenario</label>
          <div><input disabled={asking} id="rota-copilot-question" maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="What happens if Friday sales are 20% higher?" value={question} /><button className="button button--primary" disabled={asking || question.trim().length < 3} type="submit">{asking ? <LoaderCircle className="rota-copilot__spinner" size={17} /> : <Send size={17} />}{asking ? "Thinking…" : "Ask"}</button></div>
        </form>
        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
      </section>
    </section>
  );
}

function InsightColumn({ title, items, empty, icon: Icon, tone = "good" }: {
  title: string;
  items: string[];
  empty: string;
  icon: typeof ShieldCheck;
  tone?: "good" | "risk" | "action";
}) {
  return <section className={`operations-insight operations-insight--${tone}`}><header><Icon size={18} /><h3>{title}</h3></header><ul>{items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>{empty}</li>}</ul></section>;
}

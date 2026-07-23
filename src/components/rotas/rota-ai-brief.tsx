"use client";

import { useMemo, useState } from "react";
import { BrainCircuit, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import "./rota-ai-brief.css";

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
};

const prompts = [
  ["Review this saved draft", "Give me the three most important management actions before I copy this rota into RotaCloud."],
  ["Stress-test +15% sales", "Stress-test this rota against sales being 15% higher. Which exact day and time becomes most exposed?"],
  ["Find the safest saving", "Find the safest labour saving in this rota without weakening modelled cover or agreed hours."],
] as const;

const timeLabel = (value: string) => value.slice(11, 16);

export function RotaAiBrief({ plan, signals, staffTargets }: Props) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(() => {
    const shifts = plan.days.flatMap((day) => day.shifts);
    return {
      weekStart: plan.weekStart,
      forecastSales: plan.forecastSales,
      forecastRange: [plan.forecastLow, plan.forecastHigh] as [number, number],
      labourTargetPct: plan.labourTargetPct,
      labourBudget: plan.labourBudget,
      plannedCost: plan.plannedCost,
      plannedHours: plan.plannedHours,
      confidence: plan.confidence,
      warnings: plan.warnings,
      days: plan.days.map((day) => ({
        date: day.businessDate,
        forecastSales: day.forecastSales,
        labourBudget: day.labourBudget,
        plannedCost: day.plannedCost,
        plannedHours: day.plannedHours,
        peakTime: day.peakTime,
        coverageShortfalls: day.coverage
          .filter((slot) => slot.assigned < slot.required)
          .map((slot) => ({
            time: slot.slotTime,
            assigned: slot.assigned,
            required: slot.required,
          })),
        shifts: day.shifts.map((shift) => ({
          staffName: shift.staffName,
          role: shift.roleTitle,
          start: timeLabel(shift.shiftStart),
          end: timeLabel(shift.shiftEnd),
          paidHours: shift.paidMinutes / 60,
          requiredSkill: shift.requiredSkill ?? null,
          suggestedBreak: null,
        })),
      })),
      staffHours: staffTargets.map((staff) => ({
        name: staff.name,
        minimumHours: staff.minimumHours,
        targetHours: staff.targetHours,
        maximumHours: staff.maximumHours,
        plannedHours: shifts
          .filter((shift) => shift.staffProfileId === staff.id)
          .reduce((sum, shift) => sum + shift.paidMinutes / 60, 0),
      })),
      weather: signals.weather,
      nearbyEvents: signals.events,
    };
  }, [plan, signals, staffTargets]);

  const ask = async (question: string, label: string) => {
    if (activePrompt) return;
    setActivePrompt(label);
    setError(null);
    try {
      const response = await fetch("/api/rotas/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context }),
      });
      const payload = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || "AI review could not be completed.");
      setAnswer(payload.answer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI review could not be completed.");
    } finally {
      setActivePrompt(null);
    }
  };

  return (
    <section className="rota-ai-brief panel" aria-labelledby="rota-ai-brief-title">
      <div className="rota-ai-brief__heading">
        <span className="rota-ai-brief__icon"><BrainCircuit size={20} /></span>
        <div>
          <p className="page-header__eyebrow">AI challenge · saved draft</p>
          <h2 id="rota-ai-brief-title">Ask a senior operator to challenge the plan</h2>
          <p>Save the grid first. AI explains risks and options; the rota score and hard checks remain deterministic.</p>
        </div>
        <span className="rota-ai-brief__privacy"><ShieldCheck size={14} /> No salaries or individual salary data</span>
      </div>

      <div className="rota-ai-brief__actions">
        {prompts.map(([label, question], index) => (
          <button
            className={index === 0 ? "button button--primary" : "button button--secondary"}
            disabled={Boolean(activePrompt)}
            key={label}
            onClick={() => void ask(question, label)}
            type="button"
          >
            {activePrompt === label ? <LoaderCircle className="rota-copilot__spinner" size={15} /> : index === 0 ? <Sparkles size={15} /> : <RefreshCw size={15} />}
            {activePrompt === label ? "Reviewing…" : label}
          </button>
        ))}
      </div>

      {answer ? <div className="rota-ai-brief__answer" aria-live="polite">{answer}</div> : null}
      {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    </section>
  );
}

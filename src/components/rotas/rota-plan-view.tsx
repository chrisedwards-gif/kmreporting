"use client";

import { AlertTriangle, CheckCircle2, Download, Info, UsersRound } from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { formatCurrency, formatDate } from "@/lib/utils";

const formatTime = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
const dayName = (value: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

export function RotaPlanView({ plan }: { plan: StoredRotaPlan }) {
  const costVariance = plan.labourBudget - plan.plannedCost;
  const unfilled = plan.days.flatMap((day) => day.shifts).filter((shift) => !shift.staffProfileId).length;
  return (
    <section aria-labelledby="rota-plan-title" className="rota-plan">
      <div className="rota-plan__heading">
        <div><p className="page-header__eyebrow">Suggestion v{plan.version}</p><h2 id="rota-plan-title">Forecast-led weekly rota</h2><p>{plan.explanation}</p></div>
        <ExportRotaButton plan={plan} />
      </div>
      <div className="rota-plan__metrics">
        <Metric label="Forecast sales" value={formatCurrency(plan.forecastSales)} note={`${formatCurrency(plan.forecastLow)}–${formatCurrency(plan.forecastHigh)} range`} />
        <Metric label={`${plan.labourTargetPct.toFixed(1)}% labour budget`} value={formatCurrency(plan.labourBudget)} note="Loaded employer cost target" />
        <Metric label="Suggested cost" value={formatCurrency(plan.plannedCost)} note={`${plan.plannedHours.toFixed(1)} paid hours`} />
        <Metric label="Budget headroom" value={formatCurrency(costVariance)} note={costVariance >= 0 ? "Within target before edits" : "Over target due to safe cover"} tone={costVariance >= 0 ? "good" : "bad"} />
        <Metric label="Forecast confidence" value={plan.confidence.replaceAll("_", " ")} note={plan.accuracyMape == null ? "Backtest building" : `Backtest ±${plan.accuracyMape.toFixed(1)}%`} />
        <Metric label="Unfilled shifts" value={String(unfilled)} note={unfilled ? "Needs manager decision" : "Every suggested shift assigned"} tone={unfilled ? "bad" : "good"} />
      </div>

      {plan.warnings.length ? <details className="rota-plan__warnings"><summary><AlertTriangle aria-hidden="true" size={17} /> {plan.warnings.length} planning warning{plan.warnings.length === 1 ? "" : "s"}</summary><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : <div className="rota-plan__clear"><CheckCircle2 aria-hidden="true" size={17} /> No hard-constraint warnings in this suggestion.</div>}

      <div className="rota-week">
        {plan.days.map((day) => {
          const over = day.plannedCost > day.labourBudget;
          const demandSource = String(day.evidence.demandSource ?? "editable day-part template");
          return (
            <article className="rota-day" key={day.businessDate}>
              <header className="rota-day__header">
                <div><strong>{dayName(day.businessDate)}</strong><span>{formatDate(day.businessDate)}</span></div>
                <span className={`status-badge ${over ? "status-badge--changes_requested" : "status-badge--approved"}`}>{over ? "Over target" : "Within target"}</span>
              </header>
              <div className="rota-day__budget"><div><span>Sales forecast</span><strong>{formatCurrency(day.forecastSales)}</strong><small>{formatCurrency(day.forecastLow)}–{formatCurrency(day.forecastHigh)}</small></div><div><span>Labour budget</span><strong>{formatCurrency(day.labourBudget)}</strong><small>{formatCurrency(day.controllableBudget)} controllable</small></div><div><span>Plan</span><strong>{formatCurrency(day.plannedCost)}</strong><small>{day.plannedHours.toFixed(1)}h · peak {day.peakTime ?? "—"}</small></div></div>
              <div className="rota-day__shifts">
                {day.shifts.map((shift, index) => <div className={`rota-shift ${shift.staffProfileId ? "" : "rota-shift--unfilled"}`} key={`${shift.shiftStart}-${shift.staffName}-${index}`}><div className="rota-shift__time">{formatTime(shift.shiftStart)}–{formatTime(shift.shiftEnd)}</div><div className="rota-shift__person"><strong>{shift.staffName}</strong><span>{shift.roleTitle}</span></div><small>{shift.assignmentReason}</small></div>)}
              </div>
              <details className="rota-day__evidence"><summary><Info aria-hidden="true" size={14} /> Why this day?</summary><p>Forecast uses {(day.evidence.historyValues as number[] | undefined)?.length ?? 0} matching weekdays. Peak shape uses {demandSource}. Fixed labour is {formatCurrency(day.fixedLabourCost)}.</p>{day.warnings.length ? <ul>{day.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</details>
            </article>
          );
        })}
      </div>
      <div className="privacy-callout"><UsersRound aria-hidden="true" size={18} /><span>This is a suggestion, not a published rota. Check leave, availability, skill mix, wellbeing and employee agreements before entering it into RotaCloud. Individual wages are never shown here.</span></div>
    </section>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" }) {
  return <article className={`rota-metric ${tone ? `rota-metric--${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ExportRotaButton({ plan }: { plan: StoredRotaPlan }) {
  const download = () => {
    const escape = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["Date", "Staff member", "Role", "Start", "End", "Break minutes", "Paid hours", "Assignment reason"], ...plan.days.flatMap((day) => day.shifts.map((shift) => [day.businessDate, shift.staffName, shift.roleTitle, formatTime(shift.shiftStart), formatTime(shift.shiftEnd), shift.breakMinutes, (shift.paidMinutes / 60).toFixed(2), shift.assignmentReason]))];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rota-suggestion-${plan.weekStart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <button className="button button--secondary" type="button" onClick={download}><Download aria-hidden="true" size={16} /> Download for manual entry</button>;
}

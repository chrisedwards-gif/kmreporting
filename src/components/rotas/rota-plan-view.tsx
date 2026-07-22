"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, RotateCcw, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { formatCurrency, formatDate } from "@/lib/utils";

const formatTime = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
const dayName = (value: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const timeValue = (value: string) => formatTime(value);
const minutesBetween = (start: string, end: string) => Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60_000);

export function RotaPlanView({ plan }: { plan: StoredRotaPlan }) {
  const [draft, setDraft] = useState(plan);
  const [selectedDate, setSelectedDate] = useState(plan.days[0]?.businessDate ?? "");
  const [reviewed, setReviewed] = useState(false);

  const totals = useMemo(() => {
    const days = draft.days.map((day) => {
      const shifts = day.shifts.map((shift) => {
        const paidMinutes = Math.max(0, minutesBetween(shift.shiftStart, shift.shiftEnd) - shift.breakMinutes);
        const originalHours = shift.paidMinutes / 60;
        const inferredRate = originalHours > 0 ? shift.privateCost / originalHours : 0;
        const privateCost = shift.payBasis === "hourly" ? inferredRate * paidMinutes / 60 : 0;
        return { ...shift, paidMinutes, privateCost };
      });
      const plannedHours = shifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
      const plannedCost = day.fixedLabourCost + shifts.reduce((sum, shift) => sum + shift.privateCost, 0);
      return { ...day, shifts, plannedHours, plannedCost };
    });
    return {
      days,
      plannedHours: days.reduce((sum, day) => sum + day.plannedHours, 0),
      plannedCost: days.reduce((sum, day) => sum + day.plannedCost, 0),
      unfilled: days.flatMap((day) => day.shifts).filter((shift) => !shift.staffProfileId).length,
    };
  }, [draft]);

  const selectedDay = totals.days.find((day) => day.businessDate === selectedDate) ?? totals.days[0];
  const costVariance = draft.labourBudget - totals.plannedCost;
  const labourPct = draft.forecastSales > 0 ? totals.plannedCost / draft.forecastSales * 100 : 0;

  const updateShift = (date: string, index: number, field: "start" | "end" | "break", value: string) => {
    setReviewed(false);
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) => day.businessDate !== date ? day : {
        ...day,
        shifts: day.shifts.map((shift, shiftIndex) => {
          if (shiftIndex !== index) return shift;
          if (field === "break") return { ...shift, breakMinutes: Math.max(0, Number(value) || 0) };
          const datePart = shift.shiftStart.slice(0, 10);
          const offset = shift.shiftStart.slice(-6);
          return { ...shift, [field === "start" ? "shiftStart" : "shiftEnd"]: `${datePart}T${value}:00${offset}` };
        }),
      }),
    }));
  };

  const reset = () => { setDraft(plan); setReviewed(false); };

  return (
    <section aria-labelledby="rota-plan-title" className="rota-plan">
      <div className="rota-plan__heading">
        <div><p className="page-header__eyebrow">Planning workspace · suggestion v{plan.version}</p><h2 id="rota-plan-title">Build, challenge and approve next week.</h2><p>{plan.explanation}</p></div>
        <div className="rota-workspace__actions">
          <button className="button button--secondary" onClick={reset} type="button"><RotateCcw aria-hidden="true" size={16} /> Reset edits</button>
          <ExportRotaButton plan={{ ...draft, days: totals.days, plannedCost: totals.plannedCost, plannedHours: totals.plannedHours }} />
          <button className="button button--primary" disabled={totals.unfilled > 0} onClick={() => setReviewed(true)} type="button"><ShieldCheck aria-hidden="true" size={16} /> {reviewed ? "Reviewed" : "Mark reviewed"}</button>
        </div>
      </div>

      <div className="rota-plan__metrics">
        <Metric label="Forecast sales" value={formatCurrency(draft.forecastSales)} note={`${formatCurrency(draft.forecastLow)}–${formatCurrency(draft.forecastHigh)} range`} />
        <Metric label={`${draft.labourTargetPct.toFixed(1)}% labour budget`} value={formatCurrency(draft.labourBudget)} note="Loaded employer cost target" />
        <Metric label="Current plan" value={formatCurrency(totals.plannedCost)} note={`${totals.plannedHours.toFixed(1)} paid hours`} />
        <Metric label="Live labour %" value={`${labourPct.toFixed(1)}%`} note={labourPct <= draft.labourTargetPct ? "Inside target" : "Above target"} tone={labourPct <= draft.labourTargetPct ? "good" : "bad"} />
        <Metric label="Budget headroom" value={formatCurrency(costVariance)} note={costVariance >= 0 ? "Available before target" : "Over target"} tone={costVariance >= 0 ? "good" : "bad"} />
        <Metric label="Unfilled shifts" value={String(totals.unfilled)} note={totals.unfilled ? "Resolve before review" : reviewed ? "Manager reviewed" : "Ready for review"} tone={totals.unfilled ? "bad" : "good"} />
      </div>

      {plan.warnings.length ? <details className="rota-plan__warnings"><summary><AlertTriangle aria-hidden="true" size={17} /> {plan.warnings.length} original planning warning{plan.warnings.length === 1 ? "" : "s"}</summary><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : <div className="rota-plan__clear"><CheckCircle2 aria-hidden="true" size={17} /> No hard-constraint warnings in the generated suggestion.</div>}

      <div className="rota-workspace">
        <aside className="rota-workspace__days panel" aria-label="Select planning day">
          {totals.days.map((day) => {
            const over = day.plannedCost > day.labourBudget;
            return <button className={`rota-workspace__day ${selectedDay?.businessDate === day.businessDate ? "rota-workspace__day--active" : ""}`} key={day.businessDate} onClick={() => setSelectedDate(day.businessDate)} type="button"><span><strong>{dayName(day.businessDate)}</strong><small>{formatDate(day.businessDate)}</small></span><span><strong>{formatCurrency(day.forecastSales)}</strong><small className={over ? "cost-value--warning" : ""}>{day.plannedHours.toFixed(1)}h · {formatCurrency(day.plannedCost)}</small></span></button>;
          })}
        </aside>

        {selectedDay ? <article className="rota-workspace__planner panel">
          <header className="rota-workspace__planner-header">
            <div><p className="page-header__eyebrow">{dayName(selectedDay.businessDate)} · {formatDate(selectedDay.businessDate)}</p><h3>Demand and shift plan</h3></div>
            <span className={`status-badge ${selectedDay.plannedCost > selectedDay.labourBudget ? "status-badge--changes_requested" : "status-badge--approved"}`}>{selectedDay.plannedCost > selectedDay.labourBudget ? "Over target" : "Within target"}</span>
          </header>

          <div className="rota-day__budget"><div><span>Sales forecast</span><strong>{formatCurrency(selectedDay.forecastSales)}</strong><small>{formatCurrency(selectedDay.forecastLow)}–{formatCurrency(selectedDay.forecastHigh)}</small></div><div><span>Labour budget</span><strong>{formatCurrency(selectedDay.labourBudget)}</strong><small>{formatCurrency(selectedDay.controllableBudget)} controllable</small></div><div><span>Edited plan</span><strong>{formatCurrency(selectedDay.plannedCost)}</strong><small>{selectedDay.plannedHours.toFixed(1)}h · peak {selectedDay.peakTime ?? "—"}</small></div></div>

          <section className="rota-demand" aria-label="Demand and coverage by time">
            <div className="rota-demand__legend"><span><i className="rota-demand__key rota-demand__key--demand" /> Demand</span><span><i className="rota-demand__key rota-demand__key--cover" /> Required cover</span></div>
            <div className="rota-demand__chart">{selectedDay.coverage.map((slot) => {
              const maxRequired = Math.max(...selectedDay.coverage.map((item) => item.required), 1);
              const demandHeight = Math.max(5, slot.demandWeight);
              return <div className="rota-demand__slot" key={slot.slotTime}><div className="rota-demand__bars"><span className="rota-demand__bar rota-demand__bar--demand" style={{ height: `${Math.min(100, demandHeight)}%` }} /><span className="rota-demand__bar rota-demand__bar--cover" style={{ height: `${slot.required / maxRequired * 100}%` }} /></div><small>{slot.slotTime}</small><b>{slot.assigned}/{slot.required}</b></div>;
            })}</div>
          </section>

          <div className="rota-editor__heading"><div><SlidersHorizontal aria-hidden="true" size={17} /><strong>Edit shifts</strong></div><small>Times and breaks recalculate hours, cost and labour percentage immediately.</small></div>
          <div className="rota-editor">
            {selectedDay.shifts.map((shift, index) => <div className={`rota-editor__row ${shift.staffProfileId ? "" : "rota-editor__row--unfilled"}`} key={`${shift.staffName}-${index}`}>
              <div className="rota-shift__person"><strong>{shift.staffName}</strong><span>{shift.roleTitle}</span></div>
              <label><span>Start</span><input aria-label={`${shift.staffName} start`} className="field__input" disabled={!shift.staffProfileId} onChange={(event) => updateShift(selectedDay.businessDate, index, "start", event.target.value)} type="time" value={timeValue(shift.shiftStart)} /></label>
              <label><span>End</span><input aria-label={`${shift.staffName} end`} className="field__input" disabled={!shift.staffProfileId} onChange={(event) => updateShift(selectedDay.businessDate, index, "end", event.target.value)} type="time" value={timeValue(shift.shiftEnd)} /></label>
              <label><span>Break</span><input aria-label={`${shift.staffName} break minutes`} className="field__input" disabled={!shift.staffProfileId} min="0" onChange={(event) => updateShift(selectedDay.businessDate, index, "break", event.target.value)} step="5" type="number" value={shift.breakMinutes} /></label>
              <div className="rota-editor__hours"><strong>{(shift.paidMinutes / 60).toFixed(1)}h</strong><small>{shift.assignmentReason}</small></div>
            </div>)}
          </div>

          <details className="rota-day__evidence"><summary><Info aria-hidden="true" size={14} /> Forecast evidence and warnings</summary><p>Forecast uses {(selectedDay.evidence.historyValues as number[] | undefined)?.length ?? 0} matching weekdays. Peak shape uses {String(selectedDay.evidence.demandSource ?? "editable day-part template")}. Fixed labour is {formatCurrency(selectedDay.fixedLabourCost)}.</p>{selectedDay.warnings.length ? <ul>{selectedDay.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</details>
        </article> : null}
      </div>

      {reviewed ? <div className="rota-plan__clear"><CheckCircle2 aria-hidden="true" size={17} /> Manager review complete for this browser session. Download the edited CSV and reconcile daily costs in RotaCloud before publishing.</div> : null}
      <div className="privacy-callout"><UsersRound aria-hidden="true" size={18} /><span>This workspace edits a rota suggestion only. It does not publish shifts. Check leave, availability, skill mix, wellbeing and employee agreements before entering it into RotaCloud. Individual wage rates are never displayed.</span></div>
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
  return <button className="button button--secondary" type="button" onClick={download}><Download aria-hidden="true" size={16} /> Download edited CSV</button>;
}

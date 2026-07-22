"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, CloudRain, Download, Info, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, UsersRound } from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { suggestBreaks } from "@/lib/rota/breaks";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-workspace.module.css";

const formatTime = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
const dayName = (value: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const minutesBetween = (start: string, end: string) => Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60_000);

type StaffTarget = { id: string; name: string; minimumHours: number; targetHours: number; maximumHours: number };
type Props = { plan: StoredRotaPlan; signals: ExternalRotaSignals; staffTargets: StaffTarget[]; aiReview: string | null };

export function RotaPlanView({ plan, signals, staffTargets, aiReview }: Props) {
  const [draft, setDraft] = useState(plan);
  const [selectedDate, setSelectedDate] = useState(plan.days[0]?.businessDate ?? "");
  const [reviewed, setReviewed] = useState(false);

  const totals = useMemo(() => {
    const days = draft.days.map((day) => {
      const originalHourlyMinutes = day.shifts.filter((shift) => shift.staffProfileId && shift.payBasis === "hourly").reduce((sum, shift) => sum + shift.paidMinutes, 0);
      const originalHourlyCost = Math.max(0, day.plannedCost - day.fixedLabourCost);
      const blendedHourlyRate = originalHourlyMinutes > 0 ? originalHourlyCost / (originalHourlyMinutes / 60) : 0;
      const shifts = day.shifts.map((shift) => {
        const paidMinutes = Math.max(0, minutesBetween(shift.shiftStart, shift.shiftEnd) - shift.breakMinutes);
        return { ...shift, paidMinutes, privateCost: shift.payBasis === "hourly" ? blendedHourlyRate * paidMinutes / 60 : 0 };
      });
      const plannedHours = shifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
      const plannedCost = day.fixedLabourCost + shifts.reduce((sum, shift) => sum + shift.privateCost, 0);
      return { ...day, shifts, plannedHours, plannedCost };
    });
    const staffHours = staffTargets.map((staff) => ({ ...staff, plannedHours: days.flatMap((day) => day.shifts).filter((shift) => shift.staffProfileId === staff.id).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0) }));
    return {
      days,
      staffHours,
      plannedHours: days.reduce((sum, day) => sum + day.plannedHours, 0),
      plannedCost: days.reduce((sum, day) => sum + day.plannedCost, 0),
      unfilled: days.flatMap((day) => day.shifts).filter((shift) => !shift.staffProfileId).length,
    };
  }, [draft, staffTargets]);

  const selectedDay = totals.days.find((day) => day.businessDate === selectedDate) ?? totals.days[0];
  const breakSuggestions = selectedDay ? suggestBreaks(selectedDay) : [];
  const labourPct = draft.forecastSales > 0 ? totals.plannedCost / draft.forecastSales * 100 : 0;
  const shortShifts = totals.days.flatMap((day) => day.shifts).filter((shift) => shift.staffProfileId && shift.paidMinutes < 360);
  const contractShortfalls = totals.staffHours.filter((staff) => staff.plannedHours + 0.01 < staff.minimumHours);
  const reviewBlocked = totals.unfilled > 0 || contractShortfalls.length > 0 || shortShifts.length > 0;

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

  return (
    <section aria-labelledby="rota-plan-title" className="rota-plan">
      <div className="rota-plan__heading">
        <div><p className="page-header__eyebrow">Planning workspace · suggestion v{plan.version}</p><h2 id="rota-plan-title">Build, challenge and approve next week.</h2><p>{plan.explanation}</p></div>
        <div className="rota-workspace__actions"><button className="button button--secondary" onClick={() => { setDraft(plan); setReviewed(false); }} type="button"><RotateCcw aria-hidden="true" size={16} /> Reset edits</button><ExportRotaButton plan={{ ...draft, days: totals.days, plannedCost: totals.plannedCost, plannedHours: totals.plannedHours }} /><button className="button button--primary" disabled={reviewBlocked} onClick={() => setReviewed(true)} type="button"><ShieldCheck aria-hidden="true" size={16} /> {reviewed ? "Reviewed" : "Mark reviewed"}</button></div>
      </div>

      <div className="rota-plan__metrics"><Metric label="Forecast sales" value={formatCurrency(draft.forecastSales)} note={`${formatCurrency(draft.forecastLow)}–${formatCurrency(draft.forecastHigh)} range`} /><Metric label={`${draft.labourTargetPct.toFixed(1)}% labour budget`} value={formatCurrency(draft.labourBudget)} note="Loaded employer cost target" /><Metric label="Current plan" value={formatCurrency(totals.plannedCost)} note={`${totals.plannedHours.toFixed(1)} paid hours`} /><Metric label="Live labour %" value={`${labourPct.toFixed(1)}%`} note={labourPct <= draft.labourTargetPct ? "Inside target" : "Above target"} tone={labourPct <= draft.labourTargetPct ? "good" : "bad"} /><Metric label="Contract shortfalls" value={String(contractShortfalls.length)} note={contractShortfalls.length ? "Resolve or override" : "Minimum hours covered"} tone={contractShortfalls.length ? "bad" : "good"} /><Metric label="Short shifts" value={String(shortShifts.length)} note={shortShifts.length ? "Under six paid hours" : "No unexplained short shifts"} tone={shortShifts.length ? "bad" : "good"} /></div>

      <section className="rota-signal-strip panel"><div><CloudRain aria-hidden="true" size={17} /><strong>Weather</strong><span>{signals.weather.length ? `${signals.weather.length} days loaded` : "Unavailable"}</span></div><div><Sparkles aria-hidden="true" size={17} /><strong>Nearby events</strong><span>{signals.eventsConfigured ? `${signals.events.length} found` : "Add Ticketmaster key"}</span></div><small>Signals remain advisory until backtests prove a repeatable sales effect.</small></section>

      <section className="rota-ai panel"><div className="rota-ai__title"><BrainCircuit aria-hidden="true" size={20} /><div><p className="page-header__eyebrow">Operations Intelligence</p><h3>Management review</h3></div></div>{aiReview ? <p className="rota-ai__model-review">{aiReview}</p> : <ul>{contractShortfalls.map((staff) => <li key={staff.id}>{staff.name} is {(staff.minimumHours - staff.plannedHours).toFixed(1)}h below minimum hours.</li>)}{shortShifts.length ? <li>{shortShifts.length} short shift{shortShifts.length === 1 ? "" : "s"} need a peak-only or availability reason.</li> : null}{signals.weather.filter((day) => (day.precipitationMm ?? 0) >= 8).map((day) => <li key={day.date}>{formatDate(day.date)} has heavy-rain risk; review delivery and walk-in assumptions.</li>)}{signals.events.slice(0, 4).map((event) => <li key={`${event.date}-${event.title}`}>{formatDate(event.date)}: {event.title}{event.venue ? ` at ${event.venue}` : ""}; confirm whether an uplift is justified.</li>)}</ul>}</section>

      <section className="rota-hours panel"><div className="rota-editor__heading"><div><UsersRound aria-hidden="true" size={17} /><strong>Agreed-hours reconciliation</strong></div><small>Minimum is a management exception, target is preferred, and maximum is blocked.</small></div><div className="rota-hours__grid">{totals.staffHours.map((staff) => { const status = staff.plannedHours < staff.minimumHours ? "short" : staff.plannedHours > staff.maximumHours ? "over" : Math.abs(staff.plannedHours - staff.targetHours) <= 2 ? "target" : "ok"; return <div className={`rota-hours__row rota-hours__row--${status}`} key={staff.id}><strong>{staff.name}</strong><span>{staff.plannedHours.toFixed(1)}h planned</span><small>{staff.minimumHours} min · {staff.targetHours} target · {staff.maximumHours} max</small><div><i style={{ width: `${Math.min(100, staff.maximumHours ? staff.plannedHours / staff.maximumHours * 100 : 0)}%` }} /></div></div>; })}</div></section>

      <div className="rota-workspace">
        <aside aria-label="Choose planning day" className="rota-workspace__days panel">{totals.days.map((day) => <button className={`rota-workspace__day ${selectedDay?.businessDate === day.businessDate ? "rota-workspace__day--active" : ""}`} key={day.businessDate} onClick={() => setSelectedDate(day.businessDate)} type="button"><span><strong>{dayName(day.businessDate)}</strong><small>{formatDate(day.businessDate)}</small></span><span><strong>{formatCurrency(day.forecastSales)}</strong><small>{day.plannedHours.toFixed(1)}h · {formatCurrency(day.plannedCost)}</small></span></button>)}</aside>
        {selectedDay ? <article className="rota-workspace__planner panel"><header className="rota-workspace__planner-header"><div><p className="page-header__eyebrow">{dayName(selectedDay.businessDate)} · {formatDate(selectedDay.businessDate)}</p><h3>Demand heatmap and dummy rota</h3></div></header><Heatmap day={selectedDay} />
          <div className="rota-editor__heading"><div><SlidersHorizontal aria-hidden="true" size={17} /><strong>Edit shifts and breaks</strong></div><small>Breaks are staggered into the lowest-risk cover window.</small></div><div className="rota-editor">{selectedDay.shifts.map((shift, index) => { const suggestedBreak = breakSuggestions.find((item) => item.shiftIndex === index); return <div className={`rota-editor__row ${shift.staffProfileId ? "" : "rota-editor__row--unfilled"}`} key={`${shift.staffName}-${index}`}><div className="rota-shift__person"><strong>{shift.staffName}</strong><span>{shift.roleTitle}</span></div><label><span>Start</span><input aria-label={`${shift.staffName} start`} className="field__input" disabled={!shift.staffProfileId} onChange={(event) => updateShift(selectedDay.businessDate, index, "start", event.target.value)} type="time" value={formatTime(shift.shiftStart)} /></label><label><span>End</span><input aria-label={`${shift.staffName} end`} className="field__input" disabled={!shift.staffProfileId} onChange={(event) => updateShift(selectedDay.businessDate, index, "end", event.target.value)} type="time" value={formatTime(shift.shiftEnd)} /></label><label><span>Break minutes</span><input aria-label={`${shift.staffName} break minutes`} className="field__input" disabled={!shift.staffProfileId} min="0" onChange={(event) => updateShift(selectedDay.businessDate, index, "break", event.target.value)} step="5" type="number" value={shift.breakMinutes} /></label><div className="rota-editor__hours"><strong>{(shift.paidMinutes / 60).toFixed(1)}h</strong><small>{suggestedBreak?.startTime ? `Suggested break ${suggestedBreak.startTime}–${suggestedBreak.endTime}. ${suggestedBreak.reason}` : suggestedBreak?.reason ?? shift.assignmentReason}</small></div></div>; })}</div>
          <details className="rota-day__evidence"><summary><Info aria-hidden="true" size={14} /> Forecast evidence</summary><p>Forecast uses {Array.isArray(selectedDay.evidence.historyValues) ? selectedDay.evidence.historyValues.length : 0} matching weekdays. Peak source: {String(selectedDay.evidence.demandSource ?? "template")}.</p></details></article> : null}
      </div>
      {reviewed ? <div className="rota-plan__clear"><CheckCircle2 aria-hidden="true" size={17} /> Manager review complete for this browser session.</div> : reviewBlocked ? <div className="rota-plan__warnings"><AlertTriangle aria-hidden="true" size={17} /> Review blocked until unfilled shifts, contract shortfalls and unexplained short shifts are resolved.</div> : null}
    </section>
  );
}

function Heatmap({ day }: { day: StoredRotaPlan["days"][number] }) {
  const times = day.coverage.map((slot) => slot.slotTime);
  const maximumDemand = Math.max(...day.coverage.map((slot) => slot.demandWeight), 1);
  return <section className="rota-heatmap"><div className="rota-heatmap__row rota-heatmap__header"><strong>Team / demand</strong>{times.map((time) => <span key={time}>{time}</span>)}</div><div className="rota-heatmap__row"><strong>Demand</strong>{day.coverage.map((slot) => <span className="rota-heatmap__cell rota-heatmap__cell--demand" key={slot.slotTime} style={{ opacity: Math.max(0.16, slot.demandWeight / maximumDemand) }} title={`${slot.demandWeight}% demand`} />)}</div><div className="rota-heatmap__row"><strong>Cover</strong>{day.coverage.map((slot) => <span className={`rota-heatmap__cell ${slot.assigned < slot.required ? "rota-heatmap__cell--short" : slot.assigned > slot.required ? "rota-heatmap__cell--over" : "rota-heatmap__cell--right"}`} key={slot.slotTime}>{slot.assigned}/{slot.required}</span>)}</div>{day.shifts.map((shift, index) => <div className="rota-heatmap__row" key={`${shift.staffName}-${index}`}><strong>{shift.staffName}</strong>{times.map((time) => { const active = time >= shift.shiftStart.slice(11, 16) && time < shift.shiftEnd.slice(11, 16); return <span className={`rota-heatmap__cell ${active ? "rota-heatmap__cell--shift" : ""}`} key={time} />; })}</div>)}</section>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" }) { return <article className={`rota-metric ${tone ? `rota-metric--${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

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
  return <button className="button button--secondary" onClick={download} type="button"><Download aria-hidden="true" size={16} /> Download edited CSV</button>;
}

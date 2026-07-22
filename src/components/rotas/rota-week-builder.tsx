"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  CloudRain,
  Coffee,
  Copy,
  Download,
  Info,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { saveRotaBuilderDraft } from "@/app/actions/rota-builder";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import type { RotaPlanMark, SuggestedShift } from "@/lib/rota/types";
import type { RotaDisplayStaff, RotaFinanceVisibility } from "@/lib/rota/visibility";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-week-overlay.css";
import "./rota-builder.css";

export type RotaWeekBuilderProps = {
  plan: StoredRotaPlan;
  signals: ExternalRotaSignals;
  staff: RotaDisplayStaff[];
  financeVisibility: RotaFinanceVisibility;
  siteId: string;
  marks: RotaPlanMark[];
};

type DraftShift = SuggestedShift & { clientId: string };
type DraftDay = Omit<StoredRotaPlan["days"][number], "shifts"> & { shifts: DraftShift[] };

type ShiftEditor = {
  kind: "shift";
  businessDate: string;
  clientId: string | null;
  personId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  roleTitle: string;
  note: string;
};

type MarkEditor = {
  kind: "mark";
  businessDate: string;
  personId: string;
  markType: RotaPlanMark["markType"];
  note: string;
};

type EditorState = ShiftEditor | MarkEditor;

const markLabels: Record<RotaPlanMark["markType"], string> = {
  day_off: "Day off",
  unavailable: "Unavailable",
  leave: "Leave",
  training: "Training",
};

const localTime = (value: string) => new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
}).format(new Date(value));

const weekdayLabel = (date: string, width: "long" | "short" = "short") =>
  new Intl.DateTimeFormat("en-GB", { weekday: width, timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));

const hoursLabel = (hours: number) => {
  const safe = Math.max(0, hours);
  const whole = Math.floor(safe);
  const minutes = Math.round((safe - whole) * 60);
  return `${whole}h${minutes ? ` ${minutes}m` : ""}`;
};

const timeToMinutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};

const londonOffset = (date: string) => {
  const localHour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(`${date}T12:00:00Z`)));
  return localHour === 13 ? "+01:00" : "+00:00";
};

const dateTime = (date: string, time: string) => `${date}T${time}:00${londonOffset(date)}`;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;
const draftId = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function RotaWeekBuilder({
  plan,
  signals,
  staff,
  financeVisibility,
  siteId,
  marks,
}: RotaWeekBuilderProps) {
  const router = useRouter();
  const [days, setDays] = useState<DraftDay[]>(() => plan.days.map((day) => ({
    ...day,
    shifts: day.shifts.map((shift, index) => ({ ...shift, clientId: `${day.businessDate}-${index}` })),
  })));
  const [draftMarks, setDraftMarks] = useState<RotaPlanMark[]>(marks);
  const [selectedDate, setSelectedDate] = useState(plan.days[0]?.businessDate ?? "");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);

  const summary = useMemo(() => {
    const allShifts = days.flatMap((day) => day.shifts.map((shift) => ({ ...shift, businessDate: day.businessDate })));
    const hoursByStaff = new Map<string, number>();
    for (const shift of allShifts) {
      if (!shift.staffProfileId) continue;
      hoursByStaff.set(shift.staffProfileId, (hoursByStaff.get(shift.staffProfileId) ?? 0) + shift.paidMinutes / 60);
    }

    const coverageByDate = new Map(days.map((day) => {
      const slots = [...day.coverage].sort((a, b) => a.slotTime.localeCompare(b.slotTime));
      return [day.businessDate, slots.map((slot, index) => {
        const start = timeToMinutes(slot.slotTime);
        const end = slots[index + 1] ? timeToMinutes(slots[index + 1].slotTime) : start + 60;
        const assigned = day.shifts.filter((shift) => shift.staffProfileId && overlaps(
          timeToMinutes(localTime(shift.shiftStart)),
          timeToMinutes(localTime(shift.shiftEnd)),
          start,
          end,
        )).length;
        return { ...slot, assigned };
      })] as const;
    }));

    const roleMap = new Map<string, RotaDisplayStaff[]>();
    for (const person of staff) roleMap.set(person.role, [...(roleMap.get(person.role) ?? []), person]);

    const originalFixed = financeVisibility === "full" ? plan.days.reduce((sum, day) => sum + day.fixedLabourCost, 0) : 0;
    const originalHourlyMinutes = plan.days.flatMap((day) => day.shifts).reduce((sum, shift) => {
      const person = shift.staffProfileId ? staffById.get(shift.staffProfileId) : null;
      return person?.payBasis === "hourly" ? sum + shift.paidMinutes : sum;
    }, 0);
    const blendedHourlyRate = originalHourlyMinutes > 0
      ? Math.max(0, plan.plannedCost - originalFixed) / (originalHourlyMinutes / 60)
      : 0;
    const hourlyDraftMinutes = allShifts.reduce((sum, shift) => {
      const person = shift.staffProfileId ? staffById.get(shift.staffProfileId) : null;
      return person?.payBasis === "hourly" ? sum + shift.paidMinutes : sum;
    }, 0);

    const overlapWarnings = staff.flatMap((person) => days.flatMap((day) => {
      const shifts = day.shifts.filter((shift) => shift.staffProfileId === person.id);
      return shifts.flatMap((shift, index) => shifts.slice(index + 1)
        .filter((other) => overlaps(
          timeToMinutes(localTime(shift.shiftStart)),
          timeToMinutes(localTime(shift.shiftEnd)),
          timeToMinutes(localTime(other.shiftStart)),
          timeToMinutes(localTime(other.shiftEnd)),
        ))
        .map(() => ({ person: person.name, date: day.businessDate })));
    }));

    const openShifts = allShifts.filter((shift) => !shift.staffProfileId);
    const coverageGaps = [...coverageByDate.entries()].flatMap(([businessDate, coverage]) => coverage
      .filter((slot) => slot.assigned < slot.required)
      .map((slot) => ({ ...slot, businessDate })));
    const belowMinimum = staff.filter((person) => (hoursByStaff.get(person.id) ?? 0) + 0.01 < person.minimumHours);
    const aboveMaximum = staff.filter((person) => (hoursByStaff.get(person.id) ?? 0) > person.maximumHours + 0.01);
    const shortShifts = allShifts.filter((shift) => shift.staffProfileId && shift.paidMinutes < 360);

    return {
      hoursByStaff,
      coverageByDate,
      openShifts,
      coverageGaps,
      belowMinimum,
      aboveMaximum,
      shortShifts,
      overlapWarnings,
      plannedHours: allShifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0),
      plannedCost: originalFixed + blendedHourlyRate * hourlyDraftMinutes / 60,
      roleGroups: [...roleMap.entries()].map(([role, people]) => ({
        role,
        people: people.sort((a, b) => a.name.localeCompare(b.name)),
        hours: people.reduce((sum, person) => sum + (hoursByStaff.get(person.id) ?? 0), 0),
      })),
    };
  }, [days, financeVisibility, plan, staff, staffById]);

  const selectedDay = days.find((day) => day.businessDate === selectedDate) ?? days[0];
  const selectedCoverage = selectedDay ? summary.coverageByDate.get(selectedDay.businessDate) ?? [] : [];
  const selectedGaps = selectedCoverage.filter((slot) => slot.assigned < slot.required);
  const selectedPeak = [...selectedCoverage].sort((a, b) => b.demandWeight - a.demandWeight)[0];
  const selectedWeather = selectedDay ? signals.weather.find((day) => day.date === selectedDay.businessDate) : undefined;
  const selectedEvents = selectedDay ? signals.events.filter((event) => event.date === selectedDay.businessDate) : [];
  const exceptions = summary.openShifts.length + summary.coverageGaps.length + summary.overlapWarnings.length + summary.aboveMaximum.length;

  const shiftsFor = (date: string, personId: string | null) => days
    .find((day) => day.businessDate === date)?.shifts
    .filter((shift) => shift.staffProfileId === personId)
    .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart)) ?? [];

  const markFor = (date: string, personId: string) => draftMarks
    .find((mark) => mark.businessDate === date && mark.staffProfileId === personId);

  const openShiftEditor = (date: string, personId: string | null, shift?: DraftShift) => {
    const person = personId ? staffById.get(personId) : null;
    setEditor({
      kind: "shift",
      businessDate: date,
      clientId: shift?.clientId ?? null,
      personId: shift?.staffProfileId ?? personId,
      startTime: shift ? localTime(shift.shiftStart) : "10:00",
      endTime: shift ? localTime(shift.shiftEnd) : "18:00",
      breakMinutes: shift?.breakMinutes ?? 30,
      roleTitle: shift?.roleTitle ?? person?.role ?? "Kitchen team",
      note: shift?.note ?? "",
    });
    setMessage(null);
  };

  const openMarkEditor = (date: string, personId: string, mark?: RotaPlanMark) => {
    setEditor({
      kind: "mark",
      businessDate: date,
      personId,
      markType: mark?.markType ?? "day_off",
      note: mark?.note ?? "",
    });
    setMessage(null);
  };

  const saveEditor = () => {
    if (!editor) return;
    if (editor.kind === "mark") {
      const personId = editor.personId;
      setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : {
        ...day,
        shifts: day.shifts.filter((shift) => shift.staffProfileId !== personId),
      }));
      setDraftMarks((current) => [
        ...current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === personId)),
        { staffProfileId: personId, businessDate: editor.businessDate, markType: editor.markType, note: editor.note },
      ]);
      setDirty(true);
      setEditor(null);
      setMessage({ tone: "info", text: `${markLabels[editor.markType]} added. Any shift in that cell was removed.` });
      return;
    }

    const duration = timeToMinutes(editor.endTime) - timeToMinutes(editor.startTime);
    const paidMinutes = duration - editor.breakMinutes;
    if (duration <= 0 || paidMinutes <= 0) {
      setMessage({ tone: "error", text: "The finish time must be later than the start, with a valid break." });
      return;
    }

    const person = editor.personId ? staffById.get(editor.personId) : null;
    const shift: DraftShift = {
      clientId: editor.clientId ?? draftId(),
      staffProfileId: editor.personId,
      staffName: person?.name ?? "Open shift",
      roleTitle: editor.roleTitle.trim() || person?.role || "Cover required",
      shiftStart: dateTime(editor.businessDate, editor.startTime),
      shiftEnd: dateTime(editor.businessDate, editor.endTime),
      breakMinutes: editor.breakMinutes,
      paidMinutes,
      requiredSkill: null,
      assignmentReason: "Manager draft",
      payBasis: person?.payBasis ?? "unfilled",
      privateCost: 0,
      note: editor.note,
    };

    setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : {
      ...day,
      shifts: editor.clientId
        ? day.shifts.map((item) => item.clientId === editor.clientId ? shift : item)
        : [...day.shifts, shift],
    }));
    if (editor.personId) {
      const personId = editor.personId;
      setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === personId)));
    }
    setDirty(true);
    setEditor(null);
    setMessage({ tone: "info", text: editor.clientId ? "Shift updated in the draft." : "Shift added to the draft." });
  };

  const removeEditorItem = () => {
    if (!editor) return;
    if (editor.kind === "mark") {
      setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === editor.personId)));
    } else if (editor.clientId) {
      setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : {
        ...day,
        shifts: day.shifts.filter((shift) => shift.clientId !== editor.clientId),
      }));
    }
    setDirty(true);
    setEditor(null);
    setMessage({ tone: "info", text: "Item removed from the draft." });
  };

  const saveDraft = () => {
    if (plan.id === "demo-plan") {
      setDirty(false);
      setMessage({ tone: "success", text: "Demo draft saved for this browser session." });
      return;
    }
    startSaving(async () => {
      const result = await saveRotaBuilderDraft({
        planId: plan.id,
        siteId,
        weekStart: plan.weekStart,
        days: days.map((day) => ({
          businessDate: day.businessDate,
          shifts: day.shifts.map((shift) => ({
            staffProfileId: shift.staffProfileId,
            staffName: shift.staffName,
            roleTitle: shift.roleTitle,
            shiftStart: shift.shiftStart,
            shiftEnd: shift.shiftEnd,
            breakMinutes: shift.breakMinutes,
            requiredSkill: shift.requiredSkill,
            assignmentReason: shift.assignmentReason,
            note: shift.note ?? "",
          })),
        })),
        marks: draftMarks,
      });
      setMessage({ tone: result.status, text: result.message });
      if (result.status === "success") {
        setDirty(false);
        router.refresh();
      }
    });
  };

  const exportRows = () => {
    const rows = [["Person", "Date", "Start", "Finish", "Break", "Role", "Status / note"]];
    for (const day of days) {
      for (const shift of day.shifts) rows.push([
        shift.staffName,
        day.businessDate,
        localTime(shift.shiftStart),
        localTime(shift.shiftEnd),
        String(shift.breakMinutes),
        shift.roleTitle,
        shift.note ?? "",
      ]);
      for (const mark of draftMarks.filter((item) => item.businessDate === day.businessDate)) rows.push([
        staffById.get(mark.staffProfileId)?.name ?? "Team member",
        day.businessDate,
        "",
        "",
        "",
        "",
        `${markLabels[mark.markType]}${mark.note ? `: ${mark.note}` : ""}`,
      ]);
    }
    return rows;
  };

  const copyWeek = async () => {
    try {
      await navigator.clipboard.writeText(exportRows().map((row) => row.join("\t")).join("\n"));
      setMessage({ tone: "success", text: "Week copied for the RotaCloud handoff." });
    } catch {
      setMessage({ tone: "error", text: "The browser could not copy the rota. Use CSV instead." });
    }
  };

  const downloadCsv = () => {
    const csv = exportRows().map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rota-draft-${plan.weekStart}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderPersonRow = (person: RotaDisplayStaff | null) => {
    const hours = person ? summary.hoursByStaff.get(person.id) ?? 0 : 0;
    const hoursClass = !person ? "" : hours > person.maximumHours
      ? "rota-week-person__hours--danger"
      : hours + 0.01 < person.minimumHours
        ? "rota-week-person__hours--warning"
        : Math.abs(hours - person.targetHours) <= 2
          ? "rota-week-person__hours--good"
          : "";

    return (
      <div className={`rota-week-row ${person ? "" : "rota-week-row--open"}`} key={person?.id ?? "open"} role="row">
        <div className="rota-week-person" role="rowheader">
          <span className={`rota-week-avatar ${person ? "" : "rota-week-avatar--open"}`}>{person ? person.name.slice(0, 1).toUpperCase() : "OS"}</span>
          <span className="rota-week-person__copy">
            <strong>{person?.name ?? "Open shifts"}</strong>
            {person ? <small className={hoursClass}>{hoursLabel(hours)} · target {hoursLabel(person.targetHours)}</small> : <small>{summary.openShifts.length} need assigning</small>}
          </span>
        </div>
        {days.map((day) => {
          const marker = person ? markFor(day.businessDate, person.id) : undefined;
          const gap = (summary.coverageByDate.get(day.businessDate) ?? []).some((slot) => slot.assigned < slot.required);
          return (
            <div className={`rota-week-cell ${gap ? "rota-week-cell--risk" : ""}`} key={day.businessDate} role="cell">
              {marker && person ? (
                <button className={`rota-day-mark rota-day-mark--${marker.markType}`} onClick={() => openMarkEditor(day.businessDate, person.id, marker)} type="button">
                  <CalendarOff size={14} /><strong>{markLabels[marker.markType]}</strong>{marker.note ? <small>{marker.note}</small> : null}
                </button>
              ) : null}
              {shiftsFor(day.businessDate, person?.id ?? null).map((shift) => (
                <button className={`rota-week-shift ${person ? "" : "rota-week-shift--open"}`} key={shift.clientId} onClick={() => openShiftEditor(day.businessDate, person?.id ?? null, shift)} type="button">
                  <span className="rota-week-shift__edit"><Pencil size={12} /></span>
                  <strong>{localTime(shift.shiftStart)}–{localTime(shift.shiftEnd)}</strong>
                  <span>{shift.roleTitle}</span>
                  <small>{hoursLabel(shift.paidMinutes / 60)}{shift.breakMinutes ? <><Coffee size={11} /> {shift.breakMinutes}m</> : null}</small>
                  {shift.note ? <em>{shift.note}</em> : null}
                </button>
              ))}
              {!marker ? <button className="rota-week-cell__add" onClick={() => openShiftEditor(day.businessDate, person?.id ?? null)} type="button"><Plus size={14} /> Add</button> : null}
            </div>
          );
        })}
      </div>
    );
  };

  const costTitle = financeVisibility === "hourly_only" ? "Hourly labour" : "Total labour";
  const costNote = financeVisibility === "hourly_only" ? "Salaried pay stays private" : `${plan.labourTargetPct.toFixed(1)}% target`;

  return (
    <section className="rota-week-shell panel">
      <header className="rota-week-shell__header rota-builder-header">
        <div><p className="page-header__eyebrow">Working rota draft</p><h2>Build the week here, then copy it into RotaCloud.</h2><p>Click a blank cell to add a shift or day status. Click a shift to edit or remove it.</p></div>
        <div className="rota-builder-actions">
          <span className={`rota-save-state ${dirty ? "rota-save-state--dirty" : ""}`}>{dirty ? "Unsaved changes" : "Draft saved"}</span>
          <button className="button button--secondary" onClick={() => void copyWeek()} type="button"><Copy size={16} /> Copy week</button>
          <button className="button button--secondary" onClick={downloadCsv} type="button"><Download size={16} /> CSV</button>
          <button className="button button--primary" disabled={saving || !dirty} onClick={saveDraft} type="button">{saving ? <LoaderCircle className="rota-copilot__spinner" size={16} /> : <Save size={16} />}{saving ? "Saving…" : "Save draft"}</button>
        </div>
      </header>

      <div className="rota-week-shell__privacy"><Info size={16} /><span><strong>{financeVisibility === "hourly_only" ? "Kitchen-manager cost view" : "Management cost view"}</strong><small>{financeVisibility === "hourly_only" ? "Hourly-team figures only. Salaries are not sent to this screen or the copilot." : "Includes the full private labour picture."}</small></span></div>
      {message ? <p className={`form-message ${message.tone === "error" ? "form-message--error" : message.tone === "success" ? "form-message--success" : ""}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}

      <section className="rota-week-metrics">
        <article><TrendingUp size={18} /><span><small>Forecast sales</small><strong>{formatCurrency(plan.forecastSales)}</strong></span><em>{formatCurrency(plan.forecastLow)}–{formatCurrency(plan.forecastHigh)}</em></article>
        <article><UsersRound size={18} /><span><small>Draft hours</small><strong>{hoursLabel(summary.plannedHours)}</strong></span><em>{staff.reduce((sum, person) => sum + person.targetHours, 0).toFixed(1)}h team target</em></article>
        <article><Sparkles size={18} /><span><small>{costTitle}</small><strong>{formatCurrency(summary.plannedCost)}</strong></span><em>{formatCurrency(plan.labourBudget)} allowance · {costNote}</em></article>
        <article className={exceptions ? "rota-week-metric--risk" : ""}><AlertTriangle size={18} /><span><small>Blocking exceptions</small><strong>{exceptions}</strong></span><em>{summary.coverageGaps.length} cover gaps · {summary.openShifts.length} open shifts</em></article>
      </section>

      {(summary.belowMinimum.length || summary.aboveMaximum.length || summary.overlapWarnings.length || summary.shortShifts.length) ? (
        <section className="rota-builder-alerts">
          {summary.belowMinimum.slice(0, 3).map((person) => <span key={`min-${person.id}`}><AlertTriangle size={14} /> {person.name} below minimum hours</span>)}
          {summary.aboveMaximum.slice(0, 3).map((person) => <span key={`max-${person.id}`}><AlertTriangle size={14} /> {person.name} above maximum hours</span>)}
          {summary.overlapWarnings.slice(0, 2).map((warning, index) => <span key={`overlap-${index}`}><AlertTriangle size={14} /> {warning.person} overlaps on {formatDate(warning.date)}</span>)}
          {summary.shortShifts.length ? <span><AlertTriangle size={14} /> {summary.shortShifts.length} short shift{summary.shortShifts.length === 1 ? "" : "s"}</span> : null}
        </section>
      ) : <div className="rota-builder-clear"><CheckCircle2 size={16} /> Hours, overlaps and shift-length checks currently pass.</div>}

      <div className="rota-week-scroll">
        <div className="rota-week-grid" role="table" aria-label="Weekly rota builder">
          <div className="rota-week-row rota-week-row--header" role="row">
            <div className="rota-week-person rota-week-person--header" role="columnheader"><CalendarDays size={17} /><span><strong>Week summary</strong><small>{formatDate(plan.weekStart)}–{formatDate(plan.weekEnd)}</small></span></div>
            {days.map((day) => {
              const coverage = summary.coverageByDate.get(day.businessDate) ?? [];
              const gaps = coverage.filter((slot) => slot.assigned < slot.required).length;
              const maxDemand = Math.max(...coverage.map((slot) => slot.demandWeight), 1);
              const hours = day.shifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
              return (
                <button className={`rota-week-day ${selectedDay?.businessDate === day.businessDate ? "rota-week-day--selected" : ""}`} key={day.businessDate} onClick={() => setSelectedDate(day.businessDate)} role="columnheader" type="button">
                  <span className="rota-week-day__title"><strong>{weekdayLabel(day.businessDate, "long")}</strong><small>{formatDate(day.businessDate)}</small></span>
                  <span className="rota-week-day__numbers"><strong>{formatCurrency(day.forecastSales)}</strong><small>{hoursLabel(hours)} drafted</small></span>
                  <span className="rota-week-day__heat">{coverage.map((slot) => <i className={slot.assigned < slot.required ? "rota-week-day__heat-cell rota-week-day__heat-cell--risk" : "rota-week-day__heat-cell"} key={slot.slotTime} style={{ "--heat": Math.max(.14, slot.demandWeight / maxDemand) } as CSSProperties} title={`${slot.slotTime}: ${slot.assigned}/${slot.required} cover`} />)}</span>
                  <span className={`rota-week-day__status ${gaps ? "rota-week-day__status--risk" : "rota-week-day__status--good"}`}>{gaps ? `${gaps} cover gap${gaps === 1 ? "" : "s"}` : `Peak ${day.peakTime ?? "TBC"}`}</span>
                </button>
              );
            })}
          </div>
          {renderPersonRow(null)}
          {summary.roleGroups.map((group) => <section className="rota-week-role" key={group.role} role="rowgroup"><header><strong>{group.role}</strong><span>{hoursLabel(group.hours)} · {group.people.length} people</span></header>{group.people.map((person) => renderPersonRow(person))}</section>)}
        </div>
      </div>

      {selectedDay ? <section className="rota-week-insight"><header><div><p className="page-header__eyebrow">{formatDate(selectedDay.businessDate)}</p><h3>{weekdayLabel(selectedDay.businessDate, "long")} planning call</h3></div><span className={selectedGaps.length ? "rota-week-insight__badge rota-week-insight__badge--risk" : "rota-week-insight__badge"}>{selectedGaps.length ? `${selectedGaps.length} cover gaps` : "Coverage checks pass"}</span></header><div className="rota-week-insight__grid"><article><TrendingUp size={18} /><span><small>Demand</small><strong>Peak around {selectedDay.peakTime ?? selectedPeak?.slotTime ?? "TBC"}</strong><p>{formatCurrency(selectedDay.forecastLow)}–{formatCurrency(selectedDay.forecastHigh)} likely sales.</p></span></article><article><UsersRound size={18} /><span><small>Cover</small><strong>{selectedPeak ? `${selectedPeak.required} people needed at peak` : "No cover model"}</strong><p>{selectedGaps.length ? selectedGaps.slice(0, 4).map((gap) => `${gap.slotTime} (${gap.assigned}/${gap.required})`).join(", ") : "No modelled gap."}</p></span></article><article><CloudRain size={18} /><span><small>Trading signals</small><strong>{selectedWeather?.summary ?? "Weather unavailable"}</strong><p>{selectedEvents.length ? selectedEvents.slice(0, 2).map((event) => event.title).join(" · ") : "No nearby event loaded."}</p></span></article><article><Coffee size={18} /><span><small>Break guidance</small><strong>Save, then review with the copilot</strong><p>Break suggestions use the quietest covered windows.</p></span></article></div></section> : null}

      {editor ? <div className="rota-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><section aria-modal="true" className="rota-editor-dialog" role="dialog"><header><div><p className="page-header__eyebrow">{formatDate(editor.businessDate)}</p><h3>{editor.kind === "shift" && editor.clientId ? "Edit shift" : editor.kind === "mark" ? "Day status" : "Add shift"}</h3></div><button className="icon-button" onClick={() => setEditor(null)} type="button"><X size={18} /></button></header>{editor.kind === "shift" ? <><div className="rota-editor-tabs"><button className="active" type="button">Shift</button>{editor.personId ? <button onClick={() => setEditor({ kind: "mark", businessDate: editor.businessDate, personId: editor.personId!, markType: "day_off", note: "" })} type="button">Day status</button> : <button disabled type="button">Day status</button>}</div><div className="rota-editor-fields"><label><span>Team member</span><select value={editor.personId ?? ""} onChange={(event) => { const personId = event.target.value || null; setEditor({ ...editor, personId, roleTitle: personId ? staffById.get(personId)?.role ?? editor.roleTitle : "Cover required" }); }}><option value="">Open shift</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><div className="rota-editor-time-grid"><label><span>Starts</span><input type="time" value={editor.startTime} onChange={(event) => setEditor({ ...editor, startTime: event.target.value })} /></label><label><span>Finishes</span><input type="time" value={editor.endTime} onChange={(event) => setEditor({ ...editor, endTime: event.target.value })} /></label><label><span>Break</span><div className="input-suffix"><input min="0" max="180" step="5" type="number" value={editor.breakMinutes} onChange={(event) => setEditor({ ...editor, breakMinutes: Math.max(0, Number(event.target.value) || 0) })} /><span>min</span></div></label></div><label><span>Role</span><input maxLength={120} value={editor.roleTitle} onChange={(event) => setEditor({ ...editor, roleTitle: event.target.value })} /></label><label><span>Shift note</span><textarea maxLength={1500} placeholder="Station, prep focus or handover" value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label></div></> : <><div className="rota-editor-tabs"><button onClick={() => setEditor({ kind: "shift", businessDate: editor.businessDate, clientId: null, personId: editor.personId, startTime: "10:00", endTime: "18:00", breakMinutes: 30, roleTitle: staffById.get(editor.personId)?.role ?? "Kitchen team", note: "" })} type="button">Shift</button><button className="active" type="button">Day status</button></div><div className="rota-editor-fields"><label><span>Status</span><select value={editor.markType} onChange={(event) => setEditor({ ...editor, markType: event.target.value as RotaPlanMark["markType"] })}>{Object.entries(markLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="rota-editor-warning"><CalendarOff size={16} /> Saving a day status removes any shift in this cell.</p><label><span>Note</span><textarea maxLength={1000} value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label></div></>}<footer>{((editor.kind === "shift" && editor.clientId) || editor.kind === "mark") ? <button className="button button--danger" onClick={removeEditorItem} type="button"><Trash2 size={16} /> Remove</button> : <span />}<div><button className="button button--secondary" onClick={() => setEditor(null)} type="button">Cancel</button><button className="button button--primary" onClick={saveEditor} type="button"><Save size={16} /> Save</button></div></footer></section></div> : null}
    </section>
  );
}

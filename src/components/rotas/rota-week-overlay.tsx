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

type Props = {
  plan: StoredRotaPlan;
  signals: ExternalRotaSignals;
  staff: RotaDisplayStaff[];
  financeVisibility: RotaFinanceVisibility;
  siteId: string;
  marks: RotaPlanMark[];
};

type DraftShift = SuggestedShift & { clientId: string };
type DraftDay = Omit<StoredRotaPlan["days"][number], "shifts"> & { shifts: DraftShift[] };

type EditorState = {
  kind: "shift" | "mark";
  businessDate: string;
  clientId: string | null;
  personId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  roleTitle: string;
  note: string;
  markType: RotaPlanMark["markType"];
};

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
  new Intl.DateTimeFormat("en-GB", {
    weekday: width,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const hoursLabel = (hours: number) => {
  const whole = Math.floor(Math.max(0, hours));
  const minutes = Math.round((Math.max(0, hours) - whole) * 60);
  return `${whole}h${minutes ? ` ${minutes}m` : ""}`;
};

const timeToMinutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};

const minutesBetween = (start: string, end: string) =>
  Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60_000);

const londonOffset = (date: string) => {
  const utcNoon = new Date(`${date}T12:00:00Z`);
  const localHour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(utcNoon));
  return localHour === 13 ? "+01:00" : "+00:00";
};

const dateTime = (date: string, time: string) => `${date}T${time}:00${londonOffset(date)}`;
const overlaps = (startA: number, endA: number, startB: number, endB: number) => startA < endB && endA > startB;
const newClientId = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function RotaWeekOverlay({
  plan,
  signals,
  staff,
  financeVisibility,
  siteId,
  marks,
}: Props) {
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
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);

  const summary = useMemo(() => {
    const allShifts = days.flatMap((day) => day.shifts.map((shift) => ({ ...shift, businessDate: day.businessDate })));
    const hoursByStaff = new Map<string, number>();
    for (const shift of allShifts) {
      if (!shift.staffProfileId) continue;
      hoursByStaff.set(
        shift.staffProfileId,
        (hoursByStaff.get(shift.staffProfileId) ?? 0) + shift.paidMinutes / 60,
      );
    }

    const roleGroups = new Map<string, RotaDisplayStaff[]>();
    for (const person of staff) {
      const people = roleGroups.get(person.role) ?? [];
      people.push(person);
      roleGroups.set(person.role, people);
    }

    const coverageByDate = new Map(days.map((day) => {
      const sorted = [...day.coverage].sort((a, b) => a.slotTime.localeCompare(b.slotTime));
      const coverage = sorted.map((slot, index) => {
        const start = timeToMinutes(slot.slotTime);
        const end = sorted[index + 1] ? timeToMinutes(sorted[index + 1].slotTime) : start + 60;
        const assigned = day.shifts.filter((shift) => shift.staffProfileId && overlaps(
          timeToMinutes(localTime(shift.shiftStart)),
          timeToMinutes(localTime(shift.shiftEnd)),
          start,
          end,
        )).length;
        return { ...slot, assigned };
      });
      return [day.businessDate, coverage] as const;
    }));

    const originalHourlyMinutes = plan.days.flatMap((day) => day.shifts).reduce((sum, shift) => {
      const person = shift.staffProfileId ? staffById.get(shift.staffProfileId) : null;
      return person?.payBasis === "hourly" ? sum + shift.paidMinutes : sum;
    }, 0);
    const originalFixedCost = financeVisibility === "full"
      ? plan.days.reduce((sum, day) => sum + day.fixedLabourCost, 0)
      : 0;
    const originalHourlyCost = Math.max(0, plan.plannedCost - originalFixedCost);
    const blendedHourlyRate = originalHourlyMinutes > 0 ? originalHourlyCost / (originalHourlyMinutes / 60) : 0;
    const draftHourlyMinutes = allShifts.reduce((sum, shift) => {
      const person = shift.staffProfileId ? staffById.get(shift.staffProfileId) : null;
      return person?.payBasis === "hourly" ? sum + shift.paidMinutes : sum;
    }, 0);
    const plannedCost = originalFixedCost + blendedHourlyRate * draftHourlyMinutes / 60;
    const plannedHours = allShifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
    const openShifts = allShifts.filter((shift) => !shift.staffProfileId);
    const coverageGaps = [...coverageByDate.entries()].flatMap(([businessDate, coverage]) =>
      coverage.filter((slot) => slot.assigned < slot.required).map((slot) => ({ ...slot, businessDate })),
    );

    const overlapsFound = staff.flatMap((person) => days.flatMap((day) => {
      const personShifts = day.shifts.filter((shift) => shift.staffProfileId === person.id);
      return personShifts.flatMap((shift, index) => personShifts.slice(index + 1).filter((other) => overlaps(
        timeToMinutes(localTime(shift.shiftStart)),
        timeToMinutes(localTime(shift.shiftEnd)),
        timeToMinutes(localTime(other.shiftStart)),
        timeToMinutes(localTime(other.shiftEnd)),
      )).map(() => ({ person: person.name, date: day.businessDate })));
    }));

    const belowMinimum = staff.filter((person) => (hoursByStaff.get(person.id) ?? 0) + 0.01 < person.minimumHours);
    const aboveMaximum = staff.filter((person) => (hoursByStaff.get(person.id) ?? 0) > person.maximumHours + 0.01);
    const shortShifts = allShifts.filter((shift) => shift.staffProfileId && shift.paidMinutes < 360);

    return {
      allShifts,
      hoursByStaff,
      coverageByDate,
      openShifts,
      coverageGaps,
      overlapsFound,
      belowMinimum,
      aboveMaximum,
      shortShifts,
      plannedCost,
      plannedHours,
      roleGroups: [...roleGroups.entries()].map(([role, people]) => ({
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

  const costTitle = financeVisibility === "hourly_only" ? "Hourly labour" : "Total labour";
  const costNote = financeVisibility === "hourly_only" ? "Salaried pay stays private" : `${plan.labourTargetPct.toFixed(1)}% target`;
  const exceptions = summary.openShifts.length + summary.coverageGaps.length + summary.overlapsFound.length + summary.aboveMaximum.length;

  const shiftsFor = (date: string, staffProfileId: string | null) =>
    days.find((day) => day.businessDate === date)?.shifts
      .filter((shift) => shift.staffProfileId === staffProfileId)
      .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart)) ?? [];

  const markFor = (date: string, staffProfileId: string) =>
    draftMarks.find((mark) => mark.businessDate === date && mark.staffProfileId === staffProfileId);

  const openEditor = (date: string, personId: string | null, shift?: DraftShift) => {
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
      markType: "day_off",
    });
    setMessage(null);
  };

  const openMarkEditor = (date: string, personId: string, existing?: RotaPlanMark) => {
    setEditor({
      kind: "mark",
      businessDate: date,
      clientId: null,
      personId,
      startTime: "10:00",
      endTime: "18:00",
      breakMinutes: 0,
      roleTitle: staffById.get(personId)?.role ?? "Kitchen team",
      note: existing?.note ?? "",
      markType: existing?.markType ?? "day_off",
    });
    setMessage(null);
  };

  const saveEditor = () => {
    if (!editor) return;
    if (editor.kind === "mark") {
      if (!editor.personId) return;
      setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : {
        ...day,
        shifts: day.shifts.filter((shift) => shift.staffProfileId !== editor.personId),
      }));
      setDraftMarks((current) => [
        ...current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === editor.personId)),
        {
          staffProfileId: editor.personId,
          businessDate: editor.businessDate,
          markType: editor.markType,
          note: editor.note,
        },
      ]);
      setDirty(true);
      setEditor(null);
      setMessage({ tone: "info", text: `${markLabels[editor.markType]} added. Any shift in that cell was removed.` });
      return;
    }

    const start = timeToMinutes(editor.startTime);
    const end = timeToMinutes(editor.endTime);
    const duration = end - start;
    const paidMinutes = duration - editor.breakMinutes;
    if (duration <= 0 || paidMinutes <= 0) {
      setMessage({ tone: "error", text: "The finish time must be later than the start, with a valid break." });
      return;
    }

    const person = editor.personId ? staffById.get(editor.personId) : null;
    const shift: DraftShift = {
      clientId: editor.clientId ?? newClientId(),
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
        ? day.shifts.map((currentShift) => currentShift.clientId === editor.clientId ? shift : currentShift)
        : [...day.shifts, shift],
    }));
    if (editor.personId) {
      setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === editor.personId)));
    }
    setDirty(true);
    setEditor(null);
    setMessage({ tone: "info", text: editor.clientId ? "Shift updated in the draft." : "Shift added to the draft." });
  };

  const deleteEditorItem = () => {
    if (!editor) return;
    if (editor.kind === "mark" && editor.personId) {
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
    if (saving) return;
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

  const rotaText = () => {
    const rows = ["Person\tDate\tStart\tFinish\tBreak\tRole\tStatus / note"];
    for (const day of days) {
      for (const shift of day.shifts) {
        rows.push([
          shift.staffName,
          day.businessDate,
          localTime(shift.shiftStart),
          localTime(shift.shiftEnd),
          String(shift.breakMinutes),
          shift.roleTitle,
          shift.note ?? "",
        ].join("\t"));
      }
      for (const mark of draftMarks.filter((item) => item.businessDate === day.businessDate)) {
        rows.push([
          staffById.get(mark.staffProfileId)?.name ?? "Team member",
          day.businessDate,
          "",
          "",
          "",
          "",
          `${markLabels[mark.markType]}${mark.note ? `: ${mark.note}` : ""}`,
        ].join("\t"));
      }
    }
    return rows.join("\n");
  };

  const copyWeek = async () => {
    try {
      await navigator.clipboard.writeText(rotaText());
      setMessage({ tone: "success", text: "Week copied. Paste it into your RotaCloud working notes or spreadsheet." });
    } catch {
      setMessage({ tone: "error", text: "The browser could not copy the rota. Use the CSV download instead." });
    }
  };

  const downloadCsv = () => {
    const csv = rotaText().split("\n").map((row) => row.split("\t").map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rota-draft-${plan.weekStart}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderPersonRow = (person: RotaDisplayStaff | null) => {
    const hours = person ? summary.hoursByStaff.get(person.id) ?? 0 : 0;
    const hoursTone = !person
      ? ""
      : hours > person.maximumHours
        ? " rota-week-person__hours--danger"
        : hours + 0.01 < person.minimumHours
          ? " rota-week-person__hours--warning"
          : Math.abs(hours - person.targetHours) <= 2
            ? " rota-week-person__hours--good"
            : "";

    return (
      <div className={`rota-week-row ${person ? "" : "rota-week-row--open"}`} key={person?.id ?? "open-shifts"} role="row">
        <div className="rota-week-person" role="rowheader">
          <span className={`rota-week-avatar ${person ? "" : "rota-week-avatar--open"}`}>
            {person ? person.name.slice(0, 1).toUpperCase() : "OS"}
          </span>
          <span className="rota-week-person__copy">
            <strong>{person?.name ?? "Open shifts"}</strong>
            {person ? (
              <small className={hoursTone}>{hoursLabel(hours)} · target {hoursLabel(person.targetHours)}</small>
            ) : (
              <small>{summary.openShifts.length} shift{summary.openShifts.length === 1 ? "" : "s"} need assigning</small>
            )}
          </span>
        </div>

        {days.map((day) => {
          const cellShifts = shiftsFor(day.businessDate, person?.id ?? null);
          const marker = person ? markFor(day.businessDate, person.id) : undefined;
          const dayHasGap = (summary.coverageByDate.get(day.businessDate) ?? []).some((slot) => slot.assigned < slot.required);
          return (
            <div className={`rota-week-cell ${dayHasGap ? "rota-week-cell--risk" : ""}`} key={day.businessDate} role="cell">
              {marker && person ? (
                <button className={`rota-day-mark rota-day-mark--${marker.markType}`} onClick={() => openMarkEditor(day.businessDate, person.id, marker)} type="button">
                  <CalendarOff aria-hidden="true" size={14} />
                  <strong>{markLabels[marker.markType]}</strong>
                  {marker.note ? <small>{marker.note}</small> : null}
                </button>
              ) : null}
              {cellShifts.map((shift) => (
                <button className={`rota-week-shift ${!person ? "rota-week-shift--open" : ""}`} key={shift.clientId} onClick={() => openEditor(day.businessDate, person?.id ?? null, shift)} type="button">
                  <span className="rota-week-shift__edit"><Pencil aria-hidden="true" size={12} /></span>
                  <strong>{localTime(shift.shiftStart)}–{localTime(shift.shiftEnd)}</strong>
                  <span>{shift.roleTitle}</span>
                  <small>{hoursLabel(shift.paidMinutes / 60)}{shift.breakMinutes ? <><Coffee aria-hidden="true" size={11} /> {shift.breakMinutes}m</> : null}</small>
                  {shift.note ? <em>{shift.note}</em> : shift.requiredSkill ? <em>{shift.requiredSkill}</em> : null}
                </button>
              ))}
              {!marker ? (
                <button aria-label={`Add ${person?.name ?? "open"} shift on ${day.businessDate}`} className="rota-week-cell__add" onClick={() => openEditor(day.businessDate, person?.id ?? null)} type="button">
                  <Plus aria-hidden="true" size={14} /> Add
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="rota-week-shell panel">
      <header className="rota-week-shell__header rota-builder-header">
        <div>
          <p className="page-header__eyebrow">Working rota draft</p>
          <h2>Build the week here, then copy the approved rota into RotaCloud.</h2>
          <p>Click any blank cell to add a shift or day status. Click an existing shift to edit or remove it.</p>
        </div>
        <div className="rota-builder-actions">
          <span className={`rota-save-state ${dirty ? "rota-save-state--dirty" : ""}`}>
            {dirty ? "Unsaved changes" : "Draft saved"}
          </span>
          <button className="button button--secondary" onClick={() => void copyWeek()} type="button"><Copy aria-hidden="true" size={16} /> Copy week</button>
          <button className="button button--secondary" onClick={downloadCsv} type="button"><Download aria-hidden="true" size={16} /> CSV</button>
          <button className="button button--primary" disabled={saving || !dirty} onClick={saveDraft} type="button">
            {saving ? <LoaderCircle aria-hidden="true" className="rota-copilot__spinner" size={16} /> : <Save aria-hidden="true" size={16} />}
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </header>

      <div className="rota-week-shell__privacy">
        <Info aria-hidden="true" size={16} />
        <span>
          <strong>{financeVisibility === "hourly_only" ? "Kitchen-manager cost view" : "Management cost view"}</strong>
          <small>{financeVisibility === "hourly_only" ? "Hourly-team figures only. Salaries are not sent to this screen or the copilot." : "Includes the full private labour picture."}</small>
        </span>
      </div>

      {message ? <p className={`form-message ${message.tone === "error" ? "form-message--error" : message.tone === "success" ? "form-message--success" : ""}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}

      <section aria-label="Weekly planning summary" className="rota-week-metrics">
        <article><TrendingUp aria-hidden="true" size={18} /><span><small>Forecast sales</small><strong>{formatCurrency(plan.forecastSales)}</strong></span><em>{formatCurrency(plan.forecastLow)}–{formatCurrency(plan.forecastHigh)}</em></article>
        <article><UsersRound aria-hidden="true" size={18} /><span><small>Draft hours</small><strong>{hoursLabel(summary.plannedHours)}</strong></span><em>{staff.reduce((sum, person) => sum + person.targetHours, 0).toFixed(1)}h team target</em></article>
        <article><Sparkles aria-hidden="true" size={18} /><span><small>{costTitle}</small><strong>{formatCurrency(summary.plannedCost)}</strong></span><em>{formatCurrency(plan.labourBudget)} allowance · {costNote}</em></article>
        <article className={exceptions ? "rota-week-metric--risk" : ""}><AlertTriangle aria-hidden="true" size={18} /><span><small>Blocking exceptions</small><strong>{exceptions}</strong></span><em>{summary.coverageGaps.length} cover gaps · {summary.openShifts.length} open shifts</em></article>
      </section>

      {(summary.belowMinimum.length || summary.aboveMaximum.length || summary.overlapsFound.length || summary.shortShifts.length) ? (
        <section className="rota-builder-alerts" aria-label="Rota warnings">
          {summary.belowMinimum.slice(0, 3).map((person) => <span key={`min-${person.id}`}><AlertTriangle size={14} /> {person.name} below minimum hours</span>)}
          {summary.aboveMaximum.slice(0, 3).map((person) => <span key={`max-${person.id}`}><AlertTriangle size={14} /> {person.name} above maximum hours</span>)}
          {summary.overlapsFound.slice(0, 2).map((item, index) => <span key={`overlap-${index}`}><AlertTriangle size={14} /> {item.person} has overlapping shifts on {formatDate(item.date)}</span>)}
          {summary.shortShifts.length ? <span><AlertTriangle size={14} /> {summary.shortShifts.length} short shift{summary.shortShifts.length === 1 ? "" : "s"} under six paid hours</span> : null}
        </section>
      ) : <div className="rota-builder-clear"><CheckCircle2 size={16} /> Hours, overlaps and shift-length checks currently pass.</div>}

      <div className="rota-week-scroll">
        <div className="rota-week-grid" role="table" aria-label="Weekly rota builder">
          <div className="rota-week-row rota-week-row--header" role="row">
            <div className="rota-week-person rota-week-person--header" role="columnheader">
              <CalendarDays aria-hidden="true" size={17} />
              <span><strong>Week summary</strong><small>{formatDate(plan.weekStart)}–{formatDate(plan.weekEnd)}</small></span>
            </div>
            {days.map((day) => {
              const coverage = summary.coverageByDate.get(day.businessDate) ?? [];
              const gapCount = coverage.filter((slot) => slot.assigned < slot.required).length;
              const maximumDemand = Math.max(...coverage.map((slot) => slot.demandWeight), 1);
              const dayHours = day.shifts.filter((shift) => shift.staffProfileId).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
              return (
                <button className={`rota-week-day ${selectedDay?.businessDate === day.businessDate ? "rota-week-day--selected" : ""}`} key={day.businessDate} onClick={() => setSelectedDate(day.businessDate)} role="columnheader" type="button">
                  <span className="rota-week-day__title"><strong>{weekdayLabel(day.businessDate, "long")}</strong><small>{formatDate(day.businessDate)}</small></span>
                  <span className="rota-week-day__numbers"><strong>{formatCurrency(day.forecastSales)}</strong><small>{hoursLabel(dayHours)} drafted</small></span>
                  <span className="rota-week-day__heat" aria-label="Hourly demand heat">
                    {coverage.map((slot) => <i className={slot.assigned < slot.required ? "rota-week-day__heat-cell rota-week-day__heat-cell--risk" : "rota-week-day__heat-cell"} key={slot.slotTime} style={{ "--heat": Math.max(0.14, slot.demandWeight / maximumDemand) } as CSSProperties} title={`${slot.slotTime}: demand ${slot.demandWeight.toFixed(1)}%, cover ${slot.assigned}/${slot.required}`} />)}
                  </span>
                  <span className={`rota-week-day__status ${gapCount ? "rota-week-day__status--risk" : "rota-week-day__status--good"}`}>{gapCount ? `${gapCount} cover gap${gapCount === 1 ? "" : "s"}` : `Peak ${day.peakTime ?? "TBC"}`}</span>
                </button>
              );
            })}
          </div>

          {renderPersonRow(null)}
          {summary.roleGroups.map((group) => (
            <section className="rota-week-role" key={group.role} role="rowgroup">
              <header><strong>{group.role}</strong><span>{hoursLabel(group.hours)} · {group.people.length} people</span></header>
              {group.people.map((person) => renderPersonRow(person))}
            </section>
          ))}
        </div>
      </div>

      {selectedDay ? (
        <section className="rota-week-insight" aria-label={`${weekdayLabel(selectedDay.businessDate, "long")} planning insight`}>
          <header><div><p className="page-header__eyebrow">{formatDate(selectedDay.businessDate)}</p><h3>{weekdayLabel(selectedDay.businessDate, "long")} planning call</h3></div><span className={selectedGaps.length ? "rota-week-insight__badge rota-week-insight__badge--risk" : "rota-week-insight__badge"}>{selectedGaps.length ? `${selectedGaps.length} cover gap${selectedGaps.length === 1 ? "" : "s"}` : "Coverage checks pass"}</span></header>
          <div className="rota-week-insight__grid">
            <article><TrendingUp aria-hidden="true" size={18} /><span><small>Demand</small><strong>Peak around {selectedDay.peakTime ?? selectedPeak?.slotTime ?? "TBC"}</strong><p>{formatCurrency(selectedDay.forecastLow)}–{formatCurrency(selectedDay.forecastHigh)} likely sales range.</p></span></article>
            <article><UsersRound aria-hidden="true" size={18} /><span><small>Cover</small><strong>{selectedPeak ? `${selectedPeak.required} people needed at peak` : "No cover model"}</strong><p>{selectedGaps.length ? selectedGaps.map((gap) => `${gap.slotTime} (${gap.assigned}/${gap.required})`).slice(0, 4).join(", ") : "No modelled slot is below required cover."}</p></span></article>
            <article><CloudRain aria-hidden="true" size={18} /><span><small>Trading signals</small><strong>{selectedWeather?.summary ?? "Weather unavailable"}</strong><p>{selectedEvents.length ? selectedEvents.map((event) => event.title).slice(0, 2).join(" · ") : "No nearby event is currently loaded."}</p></span></article>
            <article><Coffee aria-hidden="true" size={18} /><span><small>Break guidance</small><strong>Use the quietest covered window</strong><p>The copilot will suggest precise break placement after this draft is saved.</p></span></article>
          </div>
        </section>
      ) : null}

      {editor ? (
        <div className="rota-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
          <section aria-labelledby="rota-editor-title" aria-modal="true" className="rota-editor-dialog" role="dialog">
            <header>
              <div><p className="page-header__eyebrow">{formatDate(editor.businessDate)}</p><h3 id="rota-editor-title">{editor.clientId ? "Edit rota item" : "Add rota item"}</h3></div>
              <button aria-label="Close editor" className="icon-button" onClick={() => setEditor(null)} type="button"><X size={18} /></button>
            </header>

            {editor.personId ? (
              <div className="rota-editor-tabs" role="tablist">
                <button aria-selected={editor.kind === "shift"} className={editor.kind === "shift" ? "active" : ""} onClick={() => setEditor((current) => current ? { ...current, kind: "shift" } : current)} role="tab" type="button">Shift</button>
                <button aria-selected={editor.kind === "mark"} className={editor.kind === "mark" ? "active" : ""} onClick={() => setEditor((current) => current ? { ...current, kind: "mark" } : current)} role="tab" type="button">Day status</button>
              </div>
            ) : null}

            {editor.kind === "shift" ? (
              <div className="rota-editor-fields">
                <label><span>Team member</span><select value={editor.personId ?? ""} onChange={(event) => { const personId = event.target.value || null; setEditor((current) => current ? { ...current, personId, roleTitle: personId ? staffById.get(personId)?.role ?? current.roleTitle : "Cover required" } : current); }}><option value="">Open shift</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <div className="rota-editor-time-grid"><label><span>Starts</span><input type="time" value={editor.startTime} onChange={(event) => setEditor((current) => current ? { ...current, startTime: event.target.value } : current)} /></label><label><span>Finishes</span><input type="time" value={editor.endTime} onChange={(event) => setEditor((current) => current ? { ...current, endTime: event.target.value } : current)} /></label><label><span>Break</span><div className="input-suffix"><input min="0" max="180" step="5" type="number" value={editor.breakMinutes} onChange={(event) => setEditor((current) => current ? { ...current, breakMinutes: Math.max(0, Number(event.target.value) || 0) } : current)} /><span>min</span></div></label></div>
                <label><span>Role</span><input maxLength={120} value={editor.roleTitle} onChange={(event) => setEditor((current) => current ? { ...current, roleTitle: event.target.value } : current)} /></label>
                <label><span>Shift note</span><textarea maxLength={1500} placeholder="Prep focus, station, handover or anything to copy into RotaCloud" value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} /></label>
              </div>
            ) : (
              <div className="rota-editor-fields">
                <label><span>Status</span><select value={editor.markType} onChange={(event) => setEditor((current) => current ? { ...current, markType: event.target.value as RotaPlanMark["markType"] } : current)}>{Object.entries(markLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <p className="rota-editor-warning"><CalendarOff size={16} /> Saving a day status removes any shift for this person on this date.</p>
                <label><span>Note</span><textarea maxLength={1000} placeholder="Optional manager note" value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} /></label>
              </div>
            )}

            <footer>
              {(editor.clientId || editor.kind === "mark") ? <button className="button button--danger" onClick={deleteEditorItem} type="button"><Trash2 size={16} /> Remove</button> : <span />}
              <div><button className="button button--secondary" onClick={() => setEditor(null)} type="button">Cancel</button><button className="button button--primary" onClick={saveEditor} type="button"><Save size={16} /> {editor.kind === "mark" ? "Save status" : "Save shift"}</button></div>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

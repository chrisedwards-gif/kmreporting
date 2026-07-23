"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarOff,
  Coffee,
  Copy,
  Download,
  GripVertical,
  Info,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { saveRotaBuilderDraft } from "@/app/actions/rota-builder";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import { calculateRotaScore } from "@/lib/rota/score";
import type { RotaPlanMark, SuggestedShift } from "@/lib/rota/types";
import type { RotaDisplayStaff, RotaFinanceVisibility } from "@/lib/rota/visibility";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-nory-builder.css";
import "./rota-nory-builder-v2.css";

export type RotaNoryBuilderV2Props = {
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
type DraggedShift = { clientId: string };

const markLabels: Record<RotaPlanMark["markType"], string> = {
  day_off: "Day off",
  unavailable: "Unavailable",
  leave: "Leave",
  training: "Training",
  offsite: "Off-site admin",
  head_office: "Head office",
  other_site: "Other kitchen",
};

const locationMarks = new Set<RotaPlanMark["markType"]>(["offsite", "head_office", "other_site"]);
const shiftAccents = ["#6f67d8", "#298b55", "#c9662e", "#2878b9", "#ad4e9a", "#607687"];
const roleAccent = (role: string) => shiftAccents[[...role].reduce((sum, character) => sum + character.charCodeAt(0), 0) % shiftAccents.length];
const localTime = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
const weekdayLabel = (date: string, width: "long" | "short" = "short") => new Intl.DateTimeFormat("en-GB", { weekday: width, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
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
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).format(new Date(`${date}T12:00:00Z`)));
  return localHour === 13 ? "+01:00" : "+00:00";
};
const dateTime = (date: string, time: string) => `${date}T${time}:00${londonOffset(date)}`;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;
const draftId = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isoWeek = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  const target = new Date(value.valueOf());
  const day = (value.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / 604_800_000);
};

export function RotaNoryBuilderV2({ plan, signals, staff, financeVisibility, siteId, marks }: RotaNoryBuilderV2Props) {
  const router = useRouter();
  const [days, setDays] = useState<DraftDay[]>(() => plan.days.map((day) => ({
    ...day,
    shifts: day.shifts.map((shift, index) => ({ ...shift, clientId: `${day.businessDate}-${index}` })),
  })));
  const [draftMarks, setDraftMarks] = useState<RotaPlanMark[]>(marks);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dragged, setDragged] = useState<DraggedShift | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const orderedStaff = useMemo(() => [...staff].sort((a, b) => a.roleRank - b.roleRank || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)), [staff]);
  const staffById = useMemo(() => new Map(orderedStaff.map((person) => [person.id, person])), [orderedStaff]);

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

    const roleMap = new Map<string, { rank: number; people: RotaDisplayStaff[] }>();
    for (const person of orderedStaff) {
      const group = roleMap.get(person.role) ?? { rank: person.roleRank, people: [] };
      group.people.push(person);
      group.rank = Math.min(group.rank, person.roleRank);
      roleMap.set(person.role, group);
    }

    const fixedByDate = new Map(plan.days.map((day) => [day.businessDate, financeVisibility === "full" ? day.fixedLabourCost : 0]));
    const hourlyRates = orderedStaff.filter((person) => person.payBasis === "hourly" && (person.hourlyRate ?? 0) > 0).map((person) => person.hourlyRate as number);
    const fallbackRate = hourlyRates.length ? hourlyRates.reduce((sum, rate) => sum + rate, 0) / hourlyRates.length : 0;
    const dayHoursByDate = new Map<string, number>();
    const dayCostByDate = new Map<string, number>();
    for (const day of days) {
      const assigned = day.shifts.filter((shift) => shift.staffProfileId);
      const paidHours = assigned.reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
      const hourlyCost = assigned.reduce((sum, shift) => {
        const person = shift.staffProfileId ? staffById.get(shift.staffProfileId) : null;
        if (person?.payBasis !== "hourly") return sum;
        return sum + (person.hourlyRate ?? fallbackRate) * shift.paidMinutes / 60;
      }, 0);
      dayHoursByDate.set(day.businessDate, paidHours);
      dayCostByDate.set(day.businessDate, (fixedByDate.get(day.businessDate) ?? 0) + hourlyCost);
    }

    const openShifts = allShifts.filter((shift) => !shift.staffProfileId);
    const coverageGaps = [...coverageByDate.entries()].flatMap(([businessDate, coverage]) => coverage.filter((slot) => slot.assigned < slot.required).map((slot) => ({ ...slot, businessDate })));
    const siteHourPeople = orderedStaff.filter((person) => !person.organisationWide);
    const belowMinimum = siteHourPeople.filter((person) => (hoursByStaff.get(person.id) ?? 0) + .01 < person.minimumHours);
    const aboveMaximum = siteHourPeople.filter((person) => (hoursByStaff.get(person.id) ?? 0) > person.maximumHours + .01);
    const shortShifts = allShifts.filter((shift) => shift.staffProfileId && shift.paidMinutes < 360);
    const overlapWarnings = orderedStaff.flatMap((person) => days.flatMap((day) => {
      const personShifts = day.shifts.filter((shift) => shift.staffProfileId === person.id);
      return personShifts.flatMap((shift, index) => personShifts.slice(index + 1).filter((other) => overlaps(
        timeToMinutes(localTime(shift.shiftStart)),
        timeToMinutes(localTime(shift.shiftEnd)),
        timeToMinutes(localTime(other.shiftStart)),
        timeToMinutes(localTime(other.shiftEnd)),
      )).map(() => ({ person: person.name, date: day.businessDate })));
    }));

    const coverageSlots = [...coverageByDate.values()].flat();
    const plannedCost = [...dayCostByDate.values()].reduce((sum, value) => sum + value, 0);
    const labourPct = plan.forecastSales > 0 ? plannedCost / plan.forecastSales * 100 : 0;
    const rotaScore = calculateRotaScore({
      coverage: coverageSlots,
      plannedCost,
      labourBudget: plan.labourBudget,
      totalShifts: allShifts.length,
      openShifts: openShifts.length,
      people: siteHourPeople.map((person) => ({
        plannedHours: hoursByStaff.get(person.id) ?? 0,
        targetHours: person.targetHours,
        maximumHours: person.maximumHours,
      })),
    });

    const insights: string[] = [];
    if (coverageGaps.length) {
      const first = coverageGaps[0];
      insights.push(`${formatDate(first.businessDate)} ${first.slotTime}: ${first.required - first.assigned} person short.`);
    }
    if (openShifts.length) insights.push(`${openShifts.length} open shift${openShifts.length === 1 ? "" : "s"} still need assigning.`);
    if (plannedCost > plan.labourBudget) insights.push(`${formatCurrency(plannedCost - plan.labourBudget)} above the visible labour allowance.`);
    if (belowMinimum.length) {
      const furthest = [...belowMinimum].sort((a, b) => ((hoursByStaff.get(a.id) ?? 0) - a.minimumHours) - ((hoursByStaff.get(b.id) ?? 0) - b.minimumHours))[0];
      insights.push(`${furthest.name} is ${hoursLabel(furthest.minimumHours - (hoursByStaff.get(furthest.id) ?? 0))} below minimum hours.`);
    }
    if (!insights.length) insights.push("Cover, visible cost and site-based agreed-hours checks currently pass.");

    return {
      hoursByStaff,
      coverageByDate,
      dayHoursByDate,
      dayCostByDate,
      openShifts,
      coverageGaps,
      belowMinimum,
      aboveMaximum,
      shortShifts,
      overlapWarnings,
      plannedCost,
      plannedHours: [...dayHoursByDate.values()].reduce((sum, value) => sum + value, 0),
      labourPct,
      score: rotaScore.score,
      scoreParts: rotaScore.parts,
      insights: insights.slice(0, 3),
      roleGroups: [...roleMap.entries()].map(([role, value]) => ({
        role,
        rank: value.rank,
        people: [...value.people].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
        hours: value.people.reduce((sum, person) => sum + (hoursByStaff.get(person.id) ?? 0), 0),
      })).sort((a, b) => a.rank - b.rank || a.role.localeCompare(b.role)),
    };
  }, [days, financeVisibility, orderedStaff, plan, staffById]);

  const shiftsFor = (date: string, personId: string | null) => days.find((day) => day.businessDate === date)?.shifts.filter((shift) => shift.staffProfileId === personId).sort((a, b) => a.shiftStart.localeCompare(b.shiftStart)) ?? [];
  const markFor = (date: string, personId: string) => draftMarks.find((mark) => mark.businessDate === date && mark.staffProfileId === personId);

  const openShiftEditor = (date: string, personId: string | null, shift?: DraftShift) => {
    const person = personId ? staffById.get(personId) : null;
    setEditor({ kind: "shift", businessDate: date, clientId: shift?.clientId ?? null, personId: shift?.staffProfileId ?? personId, startTime: shift ? localTime(shift.shiftStart) : "10:00", endTime: shift ? localTime(shift.shiftEnd) : "18:00", breakMinutes: shift?.breakMinutes ?? 30, roleTitle: shift?.roleTitle ?? person?.role ?? "Kitchen team", note: shift?.note ?? "" });
    setMessage(null);
  };

  const openMarkEditor = (date: string, personId: string, mark?: RotaPlanMark) => {
    setEditor({ kind: "mark", businessDate: date, personId, markType: mark?.markType ?? "day_off", note: mark?.note ?? "" });
    setMessage(null);
  };

  const saveEditor = () => {
    if (!editor) return;
    if (editor.kind === "mark") {
      const personId = editor.personId;
      setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : { ...day, shifts: day.shifts.filter((shift) => shift.staffProfileId !== personId) }));
      setDraftMarks((current) => [...current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === personId)), { staffProfileId: personId, businessDate: editor.businessDate, markType: editor.markType, note: editor.note }]);
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
    const shift: DraftShift = { clientId: editor.clientId ?? draftId(), staffProfileId: editor.personId, staffName: person?.name ?? "Open shift", roleTitle: editor.roleTitle.trim() || person?.role || "Cover required", shiftStart: dateTime(editor.businessDate, editor.startTime), shiftEnd: dateTime(editor.businessDate, editor.endTime), breakMinutes: editor.breakMinutes, paidMinutes, requiredSkill: null, assignmentReason: "Manager draft", payBasis: person?.payBasis ?? "unfilled", privateCost: 0, note: editor.note };
    setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : { ...day, shifts: editor.clientId ? day.shifts.map((item) => item.clientId === editor.clientId ? shift : item) : [...day.shifts, shift] }));
    if (editor.personId) setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === editor.personId)));
    setDirty(true);
    setEditor(null);
    setMessage({ tone: "info", text: editor.clientId ? "Shift updated in the draft." : "Shift added to the draft." });
  };

  const removeEditorItem = () => {
    if (!editor) return;
    if (editor.kind === "mark") setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === editor.businessDate && mark.staffProfileId === editor.personId)));
    else if (editor.clientId) setDays((current) => current.map((day) => day.businessDate !== editor.businessDate ? day : { ...day, shifts: day.shifts.filter((shift) => shift.clientId !== editor.clientId) }));
    setDirty(true);
    setEditor(null);
    setMessage({ tone: "info", text: "Item removed from the draft." });
  };

  const moveShift = (targetDate: string, targetPersonId: string | null) => {
    if (!dragged) return;
    const moving = days.flatMap((day) => day.shifts).find((shift) => shift.clientId === dragged.clientId);
    if (!moving) return;
    const person = targetPersonId ? staffById.get(targetPersonId) : null;
    const moved: DraftShift = { ...moving, staffProfileId: targetPersonId, staffName: person?.name ?? "Open shift", roleTitle: person?.role ?? moving.roleTitle, shiftStart: dateTime(targetDate, localTime(moving.shiftStart)), shiftEnd: dateTime(targetDate, localTime(moving.shiftEnd)), payBasis: person?.payBasis ?? "unfilled", assignmentReason: "Manager drag-and-drop" };
    setDays((current) => current.map((day) => {
      const without = day.shifts.filter((shift) => shift.clientId !== dragged.clientId);
      return day.businessDate === targetDate ? { ...day, shifts: [...without, moved] } : { ...day, shifts: without };
    }));
    if (targetPersonId) setDraftMarks((current) => current.filter((mark) => !(mark.businessDate === targetDate && mark.staffProfileId === targetPersonId)));
    setDirty(true);
    setDragged(null);
    setDropTarget(null);
    setMessage({ tone: "info", text: `Shift moved to ${person?.name ?? "Open shifts"} on ${weekdayLabel(targetDate, "long")}.` });
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
        days: days.map((day) => ({ businessDate: day.businessDate, shifts: day.shifts.map((shift) => ({ staffProfileId: shift.staffProfileId, staffName: shift.staffName, roleTitle: shift.roleTitle, shiftStart: shift.shiftStart, shiftEnd: shift.shiftEnd, breakMinutes: shift.breakMinutes, requiredSkill: shift.requiredSkill, assignmentReason: shift.assignmentReason, note: shift.note ?? "" })) })),
        marks: draftMarks,
      });
      setMessage({ tone: result.status, text: result.message });
      if (result.status === "success") { setDirty(false); router.refresh(); }
    });
  };

  const exportRows = () => {
    const rows = [["Person", "Date", "Start", "Finish", "Break", "Role", "Status / note"]];
    for (const day of days) {
      for (const shift of day.shifts) rows.push([shift.staffName, day.businessDate, localTime(shift.shiftStart), localTime(shift.shiftEnd), String(shift.breakMinutes), shift.roleTitle, shift.note ?? ""]);
      for (const mark of draftMarks.filter((item) => item.businessDate === day.businessDate)) rows.push([staffById.get(mark.staffProfileId)?.name ?? "Team member", day.businessDate, "", "", "", "", `${markLabels[mark.markType]}${mark.note ? `: ${mark.note}` : ""}`]);
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

  const renderCell = (day: DraftDay, person: RotaDisplayStaff | null) => {
    const personId = person?.id ?? null;
    const marker = person ? markFor(day.businessDate, person.id) : undefined;
    const key = `${day.businessDate}:${personId ?? "open"}`;
    const gap = (summary.coverageByDate.get(day.businessDate) ?? []).some((slot) => slot.assigned < slot.required);
    const LocationIcon = marker && locationMarks.has(marker.markType) ? marker.markType === "head_office" ? Building2 : MapPin : CalendarOff;
    return (
      <div className={`nory-rota__cell ${gap ? "nory-rota__cell--risk" : ""} ${dropTarget === key ? "nory-rota__cell--drop" : ""}`} key={day.businessDate} onDragEnter={() => setDropTarget(key)} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} onDrop={(event) => { event.preventDefault(); moveShift(day.businessDate, personId); }} role="cell">
        {marker && person ? <button className={`nory-rota__mark nory-rota__mark--${marker.markType}`} onClick={() => openMarkEditor(day.businessDate, person.id, marker)} type="button"><LocationIcon size={14} /><strong>{markLabels[marker.markType]}</strong>{marker.note ? <small>{marker.note}</small> : null}</button> : null}
        {shiftsFor(day.businessDate, personId).map((shift) => <button aria-grabbed={dragged?.clientId === shift.clientId} className={`nory-rota__shift ${person ? "" : "nory-rota__shift--open"} ${dragged?.clientId === shift.clientId ? "nory-rota__shift--dragging" : ""}`} draggable key={shift.clientId} onClick={() => openShiftEditor(day.businessDate, personId, shift)} onDragEnd={() => { setDragged(null); setDropTarget(null); }} onDragStart={(event: DragEvent<HTMLButtonElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", shift.clientId); setDragged({ clientId: shift.clientId }); }} style={{ "--shift-accent": roleAccent(shift.roleTitle) } as CSSProperties} type="button"><GripVertical aria-hidden="true" className="nory-rota__drag" size={13} /><span className="nory-rota__edit"><Pencil size={11} /></span><span>{shift.roleTitle}</span><strong>{localTime(shift.shiftStart)}–{localTime(shift.shiftEnd)}</strong><small>{shift.breakMinutes ? <><Coffee size={10} /> {shift.breakMinutes}m</> : "No break"}</small></button>)}
        {!marker ? <button className="nory-rota__add" onClick={() => openShiftEditor(day.businessDate, personId)} type="button"><Plus size={13} /> Add</button> : null}
      </div>
    );
  };

  const scoreTone = summary.score >= 85 ? "good" : summary.score >= 65 ? "watch" : "risk";
  const scoreLabel = summary.score >= 85 ? "Strong draft" : summary.score >= 65 ? "Needs review" : "Not ready";
  const siteTargetHours = orderedStaff.filter((person) => !person.organisationWide).reduce((sum, person) => sum + person.targetHours, 0);
  const costLabel = financeVisibility === "hourly_only" ? "Hourly COL %" : "COL %";

  return (
    <section className="nory-rota panel">
      <header className="nory-rota__toolbar">
        <div className="nory-rota__toolbar-copy"><p className="page-header__eyebrow">Schedule · Weekly</p><h2>Week {isoWeek(plan.weekStart)} rota</h2><p>Build shifts directly in the grid. Forecast, cover and cost update as you work.</p></div>
        <div className="nory-rota__week-summary" aria-label="Weekly rota summary"><span><small>Actual</small><strong>—</strong></span><span><small>Forecast</small><strong>{formatCurrency(plan.forecastSales)}</strong></span><span><small>Projected {costLabel}</small><strong>{summary.labourPct.toFixed(1)}%</strong></span><span><small>Site hours</small><strong>{hoursLabel(summary.plannedHours)} / {hoursLabel(siteTargetHours)}</strong></span></div>
        <div className="nory-rota__actions"><span className={`nory-rota__save-state ${dirty ? "nory-rota__save-state--dirty" : ""}`}>{dirty ? "Unsaved" : "Saved"}</span><button className="button button--secondary" onClick={() => void copyWeek()} type="button"><Copy size={15} /> Copy</button><button className="button button--secondary" onClick={downloadCsv} type="button"><Download size={15} /> CSV</button><button className="button button--primary" disabled={saving || !dirty} onClick={saveDraft} type="button">{saving ? <LoaderCircle className="rota-copilot__spinner" size={15} /> : <Save size={15} />}{saving ? "Saving…" : "Save draft"}</button></div>
      </header>

      <section className={`nory-rota__score nory-rota__score--${scoreTone}`} aria-label={`Live rota score ${summary.score} out of 100`}><div className="nory-rota__score-dial"><strong>{summary.score}</strong><small>/100</small></div><div className="nory-rota__score-copy"><span>{scoreLabel}</span><div><small>Cover {summary.scoreParts.cover}/35</small><small>Cost {summary.scoreParts.cost}/30</small><small>Assigned {summary.scoreParts.staffed}/15</small><small>Hours {summary.scoreParts.hours}/20</small></div></div><ul>{summary.insights.map((insight) => <li key={insight}><AlertTriangle size={14} /> {insight}</li>)}</ul></section>
      <div className="nory-rota__privacy"><Info size={14} /><span>{financeVisibility === "hourly_only" ? "Kitchen managers see hourly-team cost only. Salaries stay private." : "Management view includes the full private labour picture."} Organisation-wide roles are not judged against their company-wide hours on a single site.</span></div>
      {message ? <p className={`form-message ${message.tone === "error" ? "form-message--error" : message.tone === "success" ? "form-message--success" : ""}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}

      <div className="nory-rota__scroll"><div className="nory-rota__grid" role="table" aria-label="Weekly rota builder">
        <div className="nory-rota__row nory-rota__row--head" role="row"><div className="nory-rota__person nory-rota__person--head" role="columnheader"><strong>People</strong><small>Ranked by management · drag shifts</small></div>{days.map((day) => { const weather = signals.weather.find((item) => item.date === day.businessDate); const events = signals.events.filter((item) => item.date === day.businessDate); const coverage = summary.coverageByDate.get(day.businessDate) ?? []; const maxDemand = Math.max(...coverage.map((slot) => slot.demandWeight), 1); return <div className="nory-rota__day" key={day.businessDate} role="columnheader"><span><strong>{weekdayLabel(day.businessDate)}</strong><small>{formatDate(day.businessDate)}</small></span><div className="nory-rota__signals" title={[weather?.summary, ...events.map((item) => item.title)].filter(Boolean).join(" · ")}>{weather?.summary ?? "No weather"}{events.length ? ` · ${events.length} event${events.length === 1 ? "" : "s"}` : ""}</div><div className="nory-rota__heat" aria-label={`${weekdayLabel(day.businessDate)} demand heat map`}>{coverage.map((slot) => <i className={slot.assigned < slot.required ? "nory-rota__heat-segment nory-rota__heat-segment--risk" : "nory-rota__heat-segment"} key={slot.slotTime} style={{ "--heat": Math.max(.15, slot.demandWeight / maxDemand) } as CSSProperties} title={`${slot.slotTime}: ${slot.assigned}/${slot.required} cover`} />)}</div></div>; })}</div>
        <div className="nory-rota__row nory-rota__row--stat" role="row"><div className="nory-rota__stat-label" role="rowheader">Sales forecast</div>{days.map((day) => <div className="nory-rota__stat" key={day.businessDate} role="cell">{formatCurrency(day.forecastSales)}</div>)}</div>
        <div className="nory-rota__row nory-rota__row--stat" role="row"><div className="nory-rota__stat-label" role="rowheader">{costLabel}</div>{days.map((day) => { const cost = summary.dayCostByDate.get(day.businessDate) ?? 0; const col = day.forecastSales > 0 ? cost / day.forecastSales * 100 : 0; const tone = col <= plan.labourTargetPct ? "good" : col <= plan.labourTargetPct + 2 ? "watch" : "risk"; return <div className={`nory-rota__stat nory-rota__stat--${tone}`} key={day.businessDate} role="cell">{col.toFixed(1)}%</div>; })}</div>
        <div className="nory-rota__row nory-rota__row--open" role="row"><div className="nory-rota__person" role="rowheader"><span className="nory-rota__avatar nory-rota__avatar--open">OS</span><span><strong>Open shifts</strong><small>{summary.openShifts.length} unassigned</small></span></div>{days.map((day) => renderCell(day, null))}</div>
        {summary.roleGroups.map((group) => <Fragment key={group.role}><div className="nory-rota__role-row" role="presentation"><strong>{group.role}</strong><span>{hoursLabel(group.hours)} on this site</span></div>{group.people.map((person) => { const hours = summary.hoursByStaff.get(person.id) ?? 0; const hoursTone = person.organisationWide ? "plain" : hours > person.maximumHours ? "risk" : hours + .01 < person.minimumHours ? "watch" : Math.abs(hours - person.targetHours) <= 2 ? "good" : "plain"; return <div className="nory-rota__row" key={person.id} role="row"><div className="nory-rota__person" role="rowheader"><span className="nory-rota__avatar">{person.name.slice(0, 1).toUpperCase()}</span><span><strong>{person.name}</strong><small className={`nory-rota__hours nory-rota__hours--${hoursTone}`}>{person.organisationWide ? `${hoursLabel(hours)} here · group role` : `${hoursLabel(hours)} / ${hoursLabel(person.targetHours)}`}</small></span>{person.appProfileId ? <span className="nory-rota__linked" title="Linked to KM Reporting account">Linked</span> : null}</div>{days.map((day) => renderCell(day, person))}</div>; })}</Fragment>)}
      </div></div>

      {editor ? <div className="nory-editor__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><section aria-modal="true" className="nory-editor" role="dialog"><header><div><p className="page-header__eyebrow">{formatDate(editor.businessDate)}</p><h3>{editor.kind === "shift" && editor.clientId ? "Edit shift" : editor.kind === "mark" ? "Day status or location" : "Add shift"}</h3></div><button className="icon-button" onClick={() => setEditor(null)} type="button"><X size={18} /></button></header>{editor.kind === "shift" ? <><div className="nory-editor__tabs"><button className="active" type="button">Shift</button>{editor.personId ? <button onClick={() => setEditor({ kind: "mark", businessDate: editor.businessDate, personId: editor.personId!, markType: staffById.get(editor.personId)?.organisationWide ? "offsite" : "day_off", note: "" })} type="button">Status / location</button> : <button disabled type="button">Status / location</button>}</div><div className="nory-editor__fields"><label><span>Team member</span><select value={editor.personId ?? ""} onChange={(event) => { const personId = event.target.value || null; setEditor({ ...editor, personId, roleTitle: personId ? staffById.get(personId)?.role ?? editor.roleTitle : "Cover required" }); }}><option value="">Open shift</option>{orderedStaff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><div className="nory-editor__time-grid"><label><span>Starts</span><input type="time" value={editor.startTime} onChange={(event) => setEditor({ ...editor, startTime: event.target.value })} /></label><label><span>Finishes</span><input type="time" value={editor.endTime} onChange={(event) => setEditor({ ...editor, endTime: event.target.value })} /></label><label><span>Break</span><div className="input-suffix"><input min="0" max="180" step="5" type="number" value={editor.breakMinutes} onChange={(event) => setEditor({ ...editor, breakMinutes: Math.max(0, Number(event.target.value) || 0) })} /><span>min</span></div></label></div><label><span>Role</span><input maxLength={120} value={editor.roleTitle} onChange={(event) => setEditor({ ...editor, roleTitle: event.target.value })} /></label><label><span>Shift note</span><textarea maxLength={1500} placeholder="Station, prep focus or handover" value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label></div></> : <><div className="nory-editor__tabs"><button onClick={() => setEditor({ kind: "shift", businessDate: editor.businessDate, clientId: null, personId: editor.personId, startTime: "10:00", endTime: "18:00", breakMinutes: 30, roleTitle: staffById.get(editor.personId)?.role ?? "Kitchen team", note: "" })} type="button">Shift</button><button className="active" type="button">Status / location</button></div><div className="nory-editor__fields"><label><span>Status or working location</span><select value={editor.markType} onChange={(event) => setEditor({ ...editor, markType: event.target.value as RotaPlanMark["markType"] })}>{Object.entries(markLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="nory-editor__warning"><CalendarOff size={16} /> Saving a status or location removes any kitchen shift in this cell.</p><label><span>{editor.markType === "other_site" ? "Which kitchen?" : "Note"}</span><textarea maxLength={1000} placeholder={editor.markType === "head_office" ? "Admin, testing or meetings" : editor.markType === "other_site" ? "Kardia, Choi Wan…" : "Optional detail"} value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label></div></>}<footer>{((editor.kind === "shift" && editor.clientId) || editor.kind === "mark") ? <button className="button button--danger" onClick={removeEditorItem} type="button"><Trash2 size={16} /> Remove</button> : <span />}<div><button className="button button--secondary" onClick={() => setEditor(null)} type="button">Cancel</button><button className="button button--primary" onClick={saveEditor} type="button"><Save size={16} /> Save</button></div></footer></section></div> : null}
    </section>
  );
}

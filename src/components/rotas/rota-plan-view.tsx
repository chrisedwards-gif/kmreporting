"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  CloudRain,
  Download,
  Info,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { suggestBreaks, type SuggestedBreak } from "@/lib/rota/breaks";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-workspace.module.css";

const formatTime = (value: string) => new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
}).format(new Date(value));

const dayName = (value: string, length: "long" | "short" = "long") => new Intl.DateTimeFormat("en-GB", {
  weekday: length,
  timeZone: "UTC",
}).format(new Date(`${value}T12:00:00Z`));

const minutesBetween = (start: string, end: string) => Math.max(
  0,
  (new Date(end).getTime() - new Date(start).getTime()) / 60_000,
);

const percent = (cost: number, sales: number) => sales > 0 ? cost / sales * 100 : 0;

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
  aiReview: string | null;
};

type PlanningIssue = {
  key: string;
  title: string;
  detail: string;
  blocking: boolean;
};

export function RotaPlanView({ plan, signals, staffTargets, aiReview }: Props) {
  const [draft, setDraft] = useState(plan);
  const [selectedDate, setSelectedDate] = useState(plan.days[0]?.businessDate ?? "");
  const [reviewed, setReviewed] = useState(false);

  const totals = useMemo(() => {
    const days = draft.days.map((day) => {
      const originalHourlyMinutes = day.shifts
        .filter((shift) => shift.staffProfileId && shift.payBasis === "hourly")
        .reduce((sum, shift) => sum + shift.paidMinutes, 0);
      const originalHourlyCost = Math.max(0, day.plannedCost - day.fixedLabourCost);
      const blendedHourlyRate = originalHourlyMinutes > 0
        ? originalHourlyCost / (originalHourlyMinutes / 60)
        : 0;
      const shifts = day.shifts.map((shift) => {
        const paidMinutes = Math.max(
          0,
          minutesBetween(shift.shiftStart, shift.shiftEnd) - shift.breakMinutes,
        );
        return {
          ...shift,
          paidMinutes,
          privateCost: shift.payBasis === "hourly"
            ? blendedHourlyRate * paidMinutes / 60
            : 0,
        };
      });
      const plannedHours = shifts
        .filter((shift) => shift.staffProfileId)
        .reduce((sum, shift) => sum + shift.paidMinutes / 60, 0);
      const plannedCost = day.fixedLabourCost + shifts.reduce(
        (sum, shift) => sum + shift.privateCost,
        0,
      );
      return { ...day, shifts, plannedHours, plannedCost };
    });

    const allShifts = days.flatMap((day) => day.shifts);
    const staffHours = staffTargets.map((staff) => ({
      ...staff,
      plannedHours: allShifts
        .filter((shift) => shift.staffProfileId === staff.id)
        .reduce((sum, shift) => sum + shift.paidMinutes / 60, 0),
    }));

    return {
      days,
      staffHours,
      plannedHours: days.reduce((sum, day) => sum + day.plannedHours, 0),
      plannedCost: days.reduce((sum, day) => sum + day.plannedCost, 0),
      unfilled: allShifts.filter((shift) => !shift.staffProfileId).length,
    };
  }, [draft, staffTargets]);

  const selectedDay = totals.days.find((day) => day.businessDate === selectedDate) ?? totals.days[0];
  const breakSuggestions = selectedDay ? suggestBreaks(selectedDay) : [];
  const labourPct = percent(totals.plannedCost, draft.forecastSales);
  const shortShifts = totals.days.flatMap((day) => day.shifts).filter(
    (shift) => shift.staffProfileId && shift.paidMinutes < 360,
  );
  const contractShortfalls = totals.staffHours.filter(
    (staff) => staff.plannedHours + 0.01 < staff.minimumHours,
  );
  const underCovered = totals.days.flatMap((day) => day.coverage).filter(
    (slot) => slot.assigned < slot.required,
  );
  const overBudget = totals.plannedCost > draft.labourBudget;

  const issues: PlanningIssue[] = [
    ...(totals.unfilled ? [{
      key: "unfilled",
      title: `${totals.unfilled} shift${totals.unfilled === 1 ? " is" : "s are"} unfilled`,
      detail: "Assign an available team member or change the cover requirement.",
      blocking: true,
    }] : []),
    ...contractShortfalls.slice(0, 4).map((staff) => ({
      key: `hours-${staff.id}`,
      title: `${staff.name} is below minimum hours`,
      detail: `${staff.plannedHours.toFixed(1)}h planned against ${staff.minimumHours.toFixed(1)}h minimum.`,
      blocking: true,
    })),
    ...(shortShifts.length ? [{
      key: "short-shifts",
      title: `${shortShifts.length} short shift${shortShifts.length === 1 ? " needs" : "s need"} checking`,
      detail: "Shifts under six paid hours should be peak-only or caused by availability.",
      blocking: true,
    }] : []),
    ...(underCovered.length ? [{
      key: "under-cover",
      title: `${underCovered.length} time slot${underCovered.length === 1 ? " is" : "s are"} below cover`,
      detail: "Use the red cells in the rota to see exactly where the gap occurs.",
      blocking: true,
    }] : []),
    ...(overBudget ? [{
      key: "budget",
      title: "The rota is above the labour budget",
      detail: `${formatCurrency(totals.plannedCost - draft.labourBudget)} needs removing or approving as an exception.`,
      blocking: false,
    }] : []),
  ];

  const reviewBlocked = issues.some((issue) => issue.blocking);
  const nextAction = issues[0] ?? {
    key: "ready",
    title: "The rota is ready for a final manager check",
    detail: "Review the suggested breaks, then mark it reviewed and export it.",
    blocking: false,
  };

  const selectedWeather = selectedDay
    ? signals.weather.find((day) => day.date === selectedDay.businessDate)
    : undefined;
  const selectedEvents = selectedDay
    ? signals.events.filter((event) => event.date === selectedDay.businessDate)
    : [];

  const updateShift = (
    date: string,
    index: number,
    field: "start" | "end" | "break",
    value: string,
  ) => {
    setReviewed(false);
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) => day.businessDate !== date ? day : {
        ...day,
        shifts: day.shifts.map((shift, shiftIndex) => {
          if (shiftIndex !== index) return shift;
          if (field === "break") {
            return { ...shift, breakMinutes: Math.max(0, Number(value) || 0) };
          }
          const datePart = shift.shiftStart.slice(0, 10);
          const offset = shift.shiftStart.slice(-6);
          return {
            ...shift,
            [field === "start" ? "shiftStart" : "shiftEnd"]: `${datePart}T${value}:00${offset}`,
          };
        }),
      }),
    }));
  };

  const reset = () => {
    setDraft(plan);
    setReviewed(false);
  };

  return (
    <section aria-labelledby="rota-plan-title" className="rota-studio">
      <header className="rota-studio__header">
        <div>
          <p className="page-header__eyebrow">Weekly rota · version {plan.version}</p>
          <h2 id="rota-plan-title">Plan the week in four simple steps</h2>
          <p>Start with the busy periods, adjust the shifts, clear the warnings and export.</p>
        </div>
        <div className="rota-studio__actions">
          <button className="button button--secondary" onClick={reset} type="button">
            <RotateCcw aria-hidden="true" size={16} /> Reset
          </button>
          <ExportRotaButton plan={{
            ...draft,
            days: totals.days,
            plannedCost: totals.plannedCost,
            plannedHours: totals.plannedHours,
          }} />
          <button
            className="button button--primary"
            disabled={reviewBlocked}
            onClick={() => setReviewed(true)}
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={16} />
            {reviewed ? "Reviewed" : "Finish review"}
          </button>
        </div>
      </header>

      <ol aria-label="Rota planning progress" className="rota-flow">
        <FlowStep complete label="Check demand" number="1" />
        <FlowStep active={!reviewed} complete={reviewed} label="Build shifts" number="2" />
        <FlowStep active={issues.length > 0 && !reviewed} complete={!issues.length || reviewed} label="Fix warnings" number="3" />
        <FlowStep active={reviewed} complete={reviewed} label="Export rota" number="4" />
      </ol>

      <section aria-label="Weekly rota summary" className="rota-summary">
        <SummaryMetric
          label="Expected sales"
          note={`${formatCurrency(draft.forecastLow)}–${formatCurrency(draft.forecastHigh)} likely range`}
          value={formatCurrency(draft.forecastSales)}
        />
        <SummaryMetric
          label="Labour plan"
          note={`${formatCurrency(draft.labourBudget)} budget`}
          tone={overBudget ? "bad" : "good"}
          value={formatCurrency(totals.plannedCost)}
        />
        <SummaryMetric
          label="Labour percentage"
          note={`${draft.labourTargetPct.toFixed(1)}% target`}
          tone={labourPct <= draft.labourTargetPct ? "good" : "bad"}
          value={`${labourPct.toFixed(1)}%`}
        />
        <SummaryMetric
          label="Week status"
          note={issues.length ? "Work through the highlighted items" : "No blocking issues"}
          tone={issues.length ? "bad" : "good"}
          value={issues.length ? `${issues.length} to fix` : "Ready"}
        />
      </section>

      <section className={`rota-next-action ${issues.length ? "rota-next-action--warning" : "rota-next-action--ready"}`}>
        {issues.length ? <AlertTriangle aria-hidden="true" size={20} /> : <CheckCircle2 aria-hidden="true" size={20} />}
        <div>
          <span>Do this next</span>
          <strong>{nextAction.title}</strong>
          <p>{nextAction.detail}</p>
        </div>
      </section>

      <div className="rota-planner-grid">
        <aside aria-label="Choose a day" className="rota-day-rail">
          <div className="rota-day-rail__heading">
            <CalendarDays aria-hidden="true" size={17} />
            <strong>Week</strong>
          </div>
          {totals.days.map((day) => {
            const dayShortShifts = day.shifts.filter(
              (shift) => shift.staffProfileId && shift.paidMinutes < 360,
            ).length;
            const dayUnfilled = day.shifts.filter((shift) => !shift.staffProfileId).length;
            const dayUnderCover = day.coverage.filter((slot) => slot.assigned < slot.required).length;
            const issueCount = dayShortShifts + dayUnfilled + dayUnderCover;
            const dayLabourPct = percent(day.plannedCost, day.forecastSales);
            return (
              <button
                className={`rota-day-button ${selectedDay?.businessDate === day.businessDate ? "rota-day-button--active" : ""}`}
                key={day.businessDate}
                onClick={() => setSelectedDate(day.businessDate)}
                type="button"
              >
                <span className="rota-day-button__date">
                  <strong>{dayName(day.businessDate, "short")}</strong>
                  <small>{formatDate(day.businessDate)}</small>
                </span>
                <span className="rota-day-button__numbers">
                  <strong>{formatCurrency(day.forecastSales)}</strong>
                  <small>{dayLabourPct.toFixed(1)}% labour</small>
                </span>
                <span
                  aria-label={issueCount ? `${issueCount} issues` : "No issues"}
                  className={`rota-day-button__status ${issueCount ? "rota-day-button__status--warning" : "rota-day-button__status--ready"}`}
                >
                  {issueCount || <CheckCircle2 aria-hidden="true" size={14} />}
                </span>
              </button>
            );
          })}
        </aside>

        {selectedDay ? (
          <main className="rota-schedule">
            <header className="rota-schedule__header">
              <div>
                <p className="page-header__eyebrow">{formatDate(selectedDay.businessDate)}</p>
                <h3>{dayName(selectedDay.businessDate)}</h3>
              </div>
              <div className="rota-schedule__chips">
                <span>{formatCurrency(selectedDay.forecastSales)} sales</span>
                <span>{selectedDay.plannedHours.toFixed(1)} paid hours</span>
                <span>Peak {selectedDay.peakTime ?? "not known"}</span>
              </div>
            </header>

            <section className="rota-day-context" aria-label="Selected day context">
              <div>
                <CloudRain aria-hidden="true" size={17} />
                <span>
                  <strong>{selectedWeather?.summary ?? "Weather not available"}</strong>
                  <small>{selectedWeather?.temperatureMax != null ? `${selectedWeather.temperatureMax.toFixed(0)}°C high` : "Advisory signal"}</small>
                </span>
              </div>
              <div>
                <Sparkles aria-hidden="true" size={17} />
                <span>
                  <strong>{selectedEvents.length ? `${selectedEvents.length} nearby event${selectedEvents.length === 1 ? "" : "s"}` : "No nearby event loaded"}</strong>
                  <small>{selectedEvents[0]?.title ?? "Add a known local event above"}</small>
                </span>
              </div>
            </section>

            <Heatmap breakSuggestions={breakSuggestions} day={selectedDay} />

            <section className="rota-shifts">
              <div className="rota-section-heading">
                <div>
                  <h4>Shifts and breaks</h4>
                  <p>Change a time and the labour figures update immediately.</p>
                </div>
                <span>{selectedDay.shifts.length} shifts</span>
              </div>

              <div className="rota-shift-list">
                {selectedDay.shifts.map((shift, index) => {
                  const suggestedBreak = breakSuggestions.find((item) => item.shiftIndex === index);
                  const short = Boolean(shift.staffProfileId && shift.paidMinutes < 360);
                  return (
                    <article
                      className={`rota-shift-card ${!shift.staffProfileId ? "rota-shift-card--unfilled" : ""} ${short ? "rota-shift-card--warning" : ""}`}
                      key={`${shift.staffName}-${index}`}
                    >
                      <div className="rota-shift-card__person">
                        <span className="rota-avatar">{shift.staffName.slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{shift.staffName}</strong>
                          <small>{shift.roleTitle}</small>
                        </span>
                      </div>

                      <div className="rota-time-controls">
                        <label>
                          <span>Starts</span>
                          <input
                            aria-label={`${shift.staffName} start`}
                            disabled={!shift.staffProfileId}
                            onChange={(event) => updateShift(selectedDay.businessDate, index, "start", event.target.value)}
                            type="time"
                            value={formatTime(shift.shiftStart)}
                          />
                        </label>
                        <span className="rota-time-controls__dash">–</span>
                        <label>
                          <span>Finishes</span>
                          <input
                            aria-label={`${shift.staffName} finish`}
                            disabled={!shift.staffProfileId}
                            onChange={(event) => updateShift(selectedDay.businessDate, index, "end", event.target.value)}
                            type="time"
                            value={formatTime(shift.shiftEnd)}
                          />
                        </label>
                      </div>

                      <label className="rota-break-control">
                        <span>Break</span>
                        <span className="rota-break-control__input">
                          <input
                            aria-label={`${shift.staffName} break minutes`}
                            disabled={!shift.staffProfileId}
                            min="0"
                            onChange={(event) => updateShift(selectedDay.businessDate, index, "break", event.target.value)}
                            step="5"
                            type="number"
                            value={shift.breakMinutes}
                          />
                          <small>min</small>
                        </span>
                      </label>

                      <div className="rota-shift-card__result">
                        <strong>{(shift.paidMinutes / 60).toFixed(1)}h paid</strong>
                        <small className={short ? "rota-text-warning" : ""}>
                          {short ? "Short shift — check the reason" : shift.assignmentReason}
                        </small>
                      </div>

                      <BreakSuggestion suggestion={suggestedBreak} />
                    </article>
                  );
                })}
              </div>
            </section>

            <details className="rota-evidence">
              <summary><Info aria-hidden="true" size={15} /> Show forecast evidence and technical detail</summary>
              <p>{plan.explanation}</p>
              <p>
                This day uses {Array.isArray(selectedDay.evidence.historyValues) ? selectedDay.evidence.historyValues.length : 0} matching weekdays.
                Demand source: {String(selectedDay.evidence.demandSource ?? "editable template")}.
              </p>
            </details>
          </main>
        ) : null}

        <aside className="rota-coach">
          <section className="rota-coach__card rota-coach__card--attention">
            <div className="rota-coach__heading">
              <AlertTriangle aria-hidden="true" size={18} />
              <div>
                <span>Needs attention</span>
                <strong>{issues.length ? `${issues.length} item${issues.length === 1 ? "" : "s"}` : "Nothing blocking"}</strong>
              </div>
            </div>
            {issues.length ? (
              <ol className="rota-issue-list">
                {issues.map((issue) => (
                  <li key={issue.key}>
                    <strong>{issue.title}</strong>
                    <span>{issue.detail}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rota-coach__empty">All required cover, minimum hours and shift-length checks currently pass.</p>
            )}
          </section>

          <details className="rota-coach__card" open>
            <summary>
              <BrainCircuit aria-hidden="true" size={18} />
              <span><strong>Smart insights</strong><small>{aiReview ? "OpenAI review connected" : "Rule-based review"}</small></span>
            </summary>
            <div className="rota-coach__content">
              {aiReview ? <p className="rota-ai-review">{aiReview}</p> : (
                <p>
                  The planner is using the deterministic checks above. Add the OpenAI key to receive a more detailed management summary.
                </p>
              )}
            </div>
          </details>

          <details className="rota-coach__card">
            <summary>
              <UsersRound aria-hidden="true" size={18} />
              <span><strong>Team hours</strong><small>{contractShortfalls.length ? `${contractShortfalls.length} below minimum` : "Minimums covered"}</small></span>
            </summary>
            <div className="rota-team-hours">
              {totals.staffHours.map((staff) => {
                const status = staff.plannedHours < staff.minimumHours
                  ? "short"
                  : Math.abs(staff.plannedHours - staff.targetHours) <= 2
                    ? "target"
                    : "ok";
                const width = Math.min(
                  100,
                  staff.maximumHours ? staff.plannedHours / staff.maximumHours * 100 : 0,
                );
                return (
                  <div className={`rota-team-hour rota-team-hour--${status}`} key={staff.id}>
                    <div>
                      <strong>{staff.name}</strong>
                      <span>{staff.plannedHours.toFixed(1)}h / {staff.targetHours.toFixed(1)}h target</span>
                    </div>
                    <span className="rota-team-hour__track"><i style={{ width: `${width}%` }} /></span>
                    <small>{staff.minimumHours} minimum · {staff.maximumHours} maximum</small>
                  </div>
                );
              })}
            </div>
          </details>

          <details className="rota-coach__card">
            <summary>
              <CloudRain aria-hidden="true" size={18} />
              <span><strong>Weather and events</strong><small>Advisory, not automatic</small></span>
            </summary>
            <div className="rota-coach__content">
              <p>{signals.weather.length ? `${signals.weather.length} weather days loaded.` : "Weather is currently unavailable."}</p>
              <p>{signals.eventsConfigured ? `${signals.events.length} nearby events found.` : "Add a Ticketmaster key to load nearby events."}</p>
            </div>
          </details>
        </aside>
      </div>

      <footer className={`rota-review-bar ${reviewed ? "rota-review-bar--complete" : ""}`}>
        <div>
          {reviewed ? <CheckCircle2 aria-hidden="true" size={20} /> : <ShieldCheck aria-hidden="true" size={20} />}
          <span>
            <strong>{reviewed ? "Manager review complete" : reviewBlocked ? "Finish the highlighted checks" : "Ready for final review"}</strong>
            <small>{reviewed ? "Download the CSV and reconcile it in RotaCloud." : reviewBlocked ? "The review button unlocks when blocking issues are resolved." : "Check the suggested breaks, then finish the review."}</small>
          </span>
        </div>
        <button
          className="button button--primary"
          disabled={reviewBlocked}
          onClick={() => setReviewed(true)}
          type="button"
        >
          {reviewed ? "Reviewed" : "Finish review"}
        </button>
      </footer>
    </section>
  );
}

function FlowStep({ number, label, active = false, complete = false }: {
  number: string;
  label: string;
  active?: boolean;
  complete?: boolean;
}) {
  return (
    <li className={`${active ? "rota-flow__step--active" : ""} ${complete ? "rota-flow__step--complete" : ""}`}>
      <span>{complete ? <CheckCircle2 aria-hidden="true" size={16} /> : number}</span>
      <strong>{label}</strong>
    </li>
  );
}

function SummaryMetric({ label, value, note, tone }: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "bad";
}) {
  return (
    <article className={`rota-summary__metric ${tone ? `rota-summary__metric--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function BreakSuggestion({ suggestion }: { suggestion: SuggestedBreak | undefined }) {
  if (!suggestion?.startTime || !suggestion.endTime) {
    return (
      <div className="rota-break-suggestion rota-break-suggestion--muted">
        <span>Break plan</span>
        <strong>{suggestion?.reason ?? "No break needed"}</strong>
      </div>
    );
  }
  return (
    <div className="rota-break-suggestion">
      <span>Suggested break</span>
      <strong>{suggestion.startTime}–{suggestion.endTime}</strong>
      <small>{suggestion.reason}</small>
    </div>
  );
}

function Heatmap({ day, breakSuggestions }: {
  day: StoredRotaPlan["days"][number];
  breakSuggestions: SuggestedBreak[];
}) {
  const times = day.coverage.map((slot) => slot.slotTime);
  const maximumDemand = Math.max(...day.coverage.map((slot) => slot.demandWeight), 1);
  const gridStyle = { "--heat-columns": times.length } as CSSProperties;

  return (
    <section aria-label="Demand and rota coverage by hour" className="rota-heatmap">
      <div className="rota-heatmap__legend">
        <span><i className="rota-legend-key rota-legend-key--demand" /> Busier</span>
        <span><i className="rota-legend-key rota-legend-key--right" /> Right cover</span>
        <span><i className="rota-legend-key rota-legend-key--short" /> Short cover</span>
        <span><i className="rota-legend-key rota-legend-key--break" /> Break</span>
      </div>
      <div className="rota-heatmap__scroll">
        <div className="rota-heatmap__row rota-heatmap__header" style={gridStyle}>
          <strong>Team / hour</strong>
          {times.map((time) => <span key={time}>{time}</span>)}
        </div>
        <div className="rota-heatmap__row" style={gridStyle}>
          <strong>Demand</strong>
          {day.coverage.map((slot) => (
            <span
              className="rota-heatmap__cell rota-heatmap__cell--demand"
              key={slot.slotTime}
              style={{ opacity: Math.max(0.18, slot.demandWeight / maximumDemand) }}
              title={`${slot.demandWeight}% of daily demand`}
            />
          ))}
        </div>
        <div className="rota-heatmap__row rota-heatmap__cover-row" style={gridStyle}>
          <strong>Cover</strong>
          {day.coverage.map((slot) => (
            <span
              className={`rota-heatmap__cell ${slot.assigned < slot.required ? "rota-heatmap__cell--short" : slot.assigned > slot.required ? "rota-heatmap__cell--over" : "rota-heatmap__cell--right"}`}
              key={slot.slotTime}
              title={`${slot.assigned} assigned, ${slot.required} required`}
            >
              {slot.assigned}/{slot.required}
            </span>
          ))}
        </div>
        {day.shifts.map((shift, index) => {
          const breakSuggestion = breakSuggestions.find((item) => item.shiftIndex === index);
          return (
            <div className="rota-heatmap__row" key={`${shift.staffName}-${index}`} style={gridStyle}>
              <strong title={shift.staffName}>{shift.staffName}</strong>
              {times.map((time) => {
                const active = time >= shift.shiftStart.slice(11, 16) && time < shift.shiftEnd.slice(11, 16);
                const onBreak = Boolean(
                  breakSuggestion?.startTime &&
                  breakSuggestion.endTime &&
                  time >= breakSuggestion.startTime &&
                  time < breakSuggestion.endTime,
                );
                return (
                  <span
                    className={`rota-heatmap__cell ${active ? "rota-heatmap__cell--shift" : ""} ${onBreak ? "rota-heatmap__cell--break" : ""}`}
                    key={time}
                    title={onBreak ? `Suggested break ${breakSuggestion?.startTime}–${breakSuggestion?.endTime}` : active ? "Working" : "Not working"}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExportRotaButton({ plan }: { plan: StoredRotaPlan }) {
  const download = () => {
    const escape = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Date", "Staff member", "Role", "Start", "End", "Break minutes", "Suggested break start", "Suggested break end", "Paid hours", "Assignment reason"],
      ...plan.days.flatMap((day) => {
        const breaks = suggestBreaks(day);
        return day.shifts.map((shift, index) => {
          const suggestedBreak = breaks.find((item) => item.shiftIndex === index);
          return [
            day.businessDate,
            shift.staffName,
            shift.roleTitle,
            formatTime(shift.shiftStart),
            formatTime(shift.shiftEnd),
            shift.breakMinutes,
            suggestedBreak?.startTime ?? "",
            suggestedBreak?.endTime ?? "",
            (shift.paidMinutes / 60).toFixed(2),
            shift.assignmentReason,
          ];
        });
      }),
    ];
    const blob = new Blob(
      [rows.map((row) => row.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rota-suggestion-${plan.weekStart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button className="button button--secondary" onClick={download} type="button">
      <Download aria-hidden="true" size={16} /> Export CSV
    </button>
  );
}

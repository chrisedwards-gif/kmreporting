"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CloudRain,
  Coffee,
  Info,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import { suggestBreaks } from "@/lib/rota/breaks";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";
import type { RotaDisplayStaff, RotaFinanceVisibility } from "@/lib/rota/visibility";
import { formatCurrency, formatDate } from "@/lib/utils";
import "./rota-week-overlay.css";

type Props = {
  plan: StoredRotaPlan;
  signals: ExternalRotaSignals;
  staff: RotaDisplayStaff[];
  financeVisibility: RotaFinanceVisibility;
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
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}h${minutes ? ` ${minutes}m` : ""}`;
};

export function RotaWeekOverlay({
  plan,
  signals,
  staff,
  financeVisibility,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(plan.days[0]?.businessDate ?? "");

  const summary = useMemo(() => {
    const shifts = plan.days.flatMap((day) => day.shifts.map((shift) => ({
      ...shift,
      businessDate: day.businessDate,
    })));
    const hoursByStaff = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.staffProfileId) continue;
      hoursByStaff.set(
        shift.staffProfileId,
        (hoursByStaff.get(shift.staffProfileId) ?? 0) + shift.paidMinutes / 60,
      );
    }
    const unfilled = shifts.filter((shift) => !shift.staffProfileId);
    const coverageGaps = plan.days.flatMap((day) =>
      day.coverage
        .filter((slot) => slot.assigned < slot.required)
        .map((slot) => ({ ...slot, businessDate: day.businessDate })),
    );
    const roleGroups = new Map<string, RotaDisplayStaff[]>();
    for (const person of staff) {
      const people = roleGroups.get(person.role) ?? [];
      people.push(person);
      roleGroups.set(person.role, people);
    }
    return {
      hoursByStaff,
      unfilled,
      coverageGaps,
      roleGroups: [...roleGroups.entries()].map(([role, people]) => ({
        role,
        people: people.sort((a, b) => a.name.localeCompare(b.name)),
        hours: people.reduce((sum, person) => sum + (hoursByStaff.get(person.id) ?? 0), 0),
      })),
    };
  }, [plan, staff]);

  const selectedDay = plan.days.find((day) => day.businessDate === selectedDate) ?? plan.days[0];
  const selectedWeather = selectedDay
    ? signals.weather.find((day) => day.date === selectedDay.businessDate)
    : undefined;
  const selectedEvents = selectedDay
    ? signals.events.filter((event) => event.date === selectedDay.businessDate)
    : [];
  const selectedBreaks = selectedDay ? suggestBreaks(selectedDay) : [];
  const selectedGaps = selectedDay
    ? selectedDay.coverage.filter((slot) => slot.assigned < slot.required)
    : [];
  const selectedPeak = selectedDay
    ? [...selectedDay.coverage].sort((a, b) => b.demandWeight - a.demandWeight)[0]
    : undefined;

  const costTitle = financeVisibility === "hourly_only"
    ? "Hourly labour"
    : "Total labour";
  const costNote = financeVisibility === "hourly_only"
    ? "Salaried pay stays private"
    : `${plan.labourTargetPct.toFixed(1)}% target`;

  const shiftsFor = (date: string, staffProfileId: string | null) =>
    plan.days
      .find((day) => day.businessDate === date)
      ?.shifts
      .filter((shift) => shift.staffProfileId === staffProfileId)
      .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart)) ?? [];

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
      <div className={`rota-week-row ${person ? "" : "rota-week-row--open"}`} key={person?.id ?? "open-shifts"}>
        <div className="rota-week-person">
          <span className={`rota-week-avatar ${person ? "" : "rota-week-avatar--open"}`}>
            {person ? person.name.slice(0, 1).toUpperCase() : "OS"}
          </span>
          <span className="rota-week-person__copy">
            <strong>{person?.name ?? "Open shifts"}</strong>
            {person ? (
              <small className={hoursTone}>
                {hoursLabel(hours)} · target {hoursLabel(person.targetHours)}
              </small>
            ) : (
              <small>{summary.unfilled.length} shift{summary.unfilled.length === 1 ? "" : "s"} need assigning</small>
            )}
          </span>
        </div>

        {plan.days.map((day) => {
          const shifts = shiftsFor(day.businessDate, person?.id ?? null);
          const dayHasGap = day.coverage.some((slot) => slot.assigned < slot.required);
          return (
            <div
              className={`rota-week-cell ${dayHasGap ? "rota-week-cell--risk" : ""}`}
              key={day.businessDate}
            >
              {shifts.map((shift, index) => (
                <article
                  className={`rota-week-shift ${!person ? "rota-week-shift--open" : ""}`}
                  key={`${shift.shiftStart}-${shift.shiftEnd}-${index}`}
                >
                  <strong>{localTime(shift.shiftStart)}–{localTime(shift.shiftEnd)}</strong>
                  <span>{shift.roleTitle}</span>
                  <small>
                    {hoursLabel(shift.paidMinutes / 60)}
                    {shift.breakMinutes ? (
                      <><Coffee aria-hidden="true" size={11} /> {shift.breakMinutes}m</>
                    ) : null}
                  </small>
                  {shift.requiredSkill ? <em>{shift.requiredSkill}</em> : null}
                </article>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="rota-week-shell panel">
      <header className="rota-week-shell__header">
        <div>
          <p className="page-header__eyebrow">Rota planning overlay</p>
          <h2>Build in RotaCloud. Decide here with better information.</h2>
          <p>
            The layout mirrors the weekly rota view your managers already know, while forecast,
            cover and hours guidance sit directly on top.
          </p>
        </div>
        <div className="rota-week-shell__privacy">
          <Info aria-hidden="true" size={16} />
          <span>
            <strong>{financeVisibility === "hourly_only" ? "Kitchen-manager cost view" : "Management cost view"}</strong>
            <small>{financeVisibility === "hourly_only" ? "Hourly-team figures only. Salaries are not sent to this screen." : "Includes the full private labour picture."}</small>
          </span>
        </div>
      </header>

      <section aria-label="Weekly planning summary" className="rota-week-metrics">
        <article>
          <TrendingUp aria-hidden="true" size={18} />
          <span><small>Forecast sales</small><strong>{formatCurrency(plan.forecastSales)}</strong></span>
          <em>{formatCurrency(plan.forecastLow)}–{formatCurrency(plan.forecastHigh)}</em>
        </article>
        <article>
          <UsersRound aria-hidden="true" size={18} />
          <span><small>Planned hours</small><strong>{hoursLabel(plan.plannedHours)}</strong></span>
          <em>{staff.reduce((sum, person) => sum + person.targetHours, 0).toFixed(1)}h team target</em>
        </article>
        <article>
          <Sparkles aria-hidden="true" size={18} />
          <span><small>{costTitle}</small><strong>{formatCurrency(plan.plannedCost)}</strong></span>
          <em>{formatCurrency(plan.labourBudget)} allowance · {costNote}</em>
        </article>
        <article className={summary.coverageGaps.length || summary.unfilled.length ? "rota-week-metric--risk" : ""}>
          <AlertTriangle aria-hidden="true" size={18} />
          <span><small>Planning exceptions</small><strong>{summary.coverageGaps.length + summary.unfilled.length}</strong></span>
          <em>{summary.coverageGaps.length} cover gaps · {summary.unfilled.length} open shifts</em>
        </article>
      </section>

      <div className="rota-week-scroll">
        <div className="rota-week-grid" role="table" aria-label="Weekly rota planning overlay">
          <div className="rota-week-row rota-week-row--header" role="row">
            <div className="rota-week-person rota-week-person--header">
              <CalendarDays aria-hidden="true" size={17} />
              <span><strong>Week summary</strong><small>{formatDate(plan.weekStart)}–{formatDate(plan.weekEnd)}</small></span>
            </div>
            {plan.days.map((day) => {
              const gapCount = day.coverage.filter((slot) => slot.assigned < slot.required).length;
              const maximumDemand = Math.max(...day.coverage.map((slot) => slot.demandWeight), 1);
              const dayCostOver = day.plannedCost > day.labourBudget;
              return (
                <button
                  className={`rota-week-day ${selectedDay?.businessDate === day.businessDate ? "rota-week-day--selected" : ""}`}
                  key={day.businessDate}
                  onClick={() => setSelectedDate(day.businessDate)}
                  type="button"
                >
                  <span className="rota-week-day__title">
                    <strong>{weekdayLabel(day.businessDate, "long")}</strong>
                    <small>{formatDate(day.businessDate)}</small>
                  </span>
                  <span className="rota-week-day__numbers">
                    <strong>{formatCurrency(day.forecastSales)}</strong>
                    <small>{hoursLabel(day.plannedHours)} planned</small>
                  </span>
                  <span className="rota-week-day__heat" aria-label="Hourly demand heat">
                    {day.coverage.map((slot) => (
                      <i
                        className={slot.assigned < slot.required ? "rota-week-day__heat-cell rota-week-day__heat-cell--risk" : "rota-week-day__heat-cell"}
                        key={slot.slotTime}
                        style={{ "--heat": Math.max(0.14, slot.demandWeight / maximumDemand) } as CSSProperties}
                        title={`${slot.slotTime}: demand ${slot.demandWeight.toFixed(1)}%, cover ${slot.assigned}/${slot.required}`}
                      />
                    ))}
                  </span>
                  <span className={`rota-week-day__status ${gapCount ? "rota-week-day__status--risk" : dayCostOver ? "rota-week-day__status--watch" : "rota-week-day__status--good"}`}>
                    {gapCount ? `${gapCount} cover gap${gapCount === 1 ? "" : "s"}` : dayCostOver ? "Above allowance" : `Peak ${day.peakTime ?? "TBC"}`}
                  </span>
                </button>
              );
            })}
          </div>

          {renderPersonRow(null)}

          {summary.roleGroups.map((group) => (
            <section className="rota-week-role" key={group.role}>
              <header>
                <strong>{group.role}</strong>
                <span>{hoursLabel(group.hours)} · {group.people.length} people</span>
              </header>
              {group.people.map((person) => renderPersonRow(person))}
            </section>
          ))}
        </div>
      </div>

      {selectedDay ? (
        <section className="rota-week-insight" aria-label={`${weekdayLabel(selectedDay.businessDate, "long")} planning insight`}>
          <header>
            <div>
              <p className="page-header__eyebrow">{formatDate(selectedDay.businessDate)}</p>
              <h3>{weekdayLabel(selectedDay.businessDate, "long")} planning call</h3>
            </div>
            <span className={selectedGaps.length ? "rota-week-insight__badge rota-week-insight__badge--risk" : "rota-week-insight__badge"}>
              {selectedGaps.length ? `${selectedGaps.length} cover gap${selectedGaps.length === 1 ? "" : "s"}` : "Coverage checks pass"}
            </span>
          </header>

          <div className="rota-week-insight__grid">
            <article>
              <TrendingUp aria-hidden="true" size={18} />
              <span>
                <small>Demand</small>
                <strong>Peak around {selectedDay.peakTime ?? selectedPeak?.slotTime ?? "TBC"}</strong>
                <p>{formatCurrency(selectedDay.forecastLow)}–{formatCurrency(selectedDay.forecastHigh)} likely sales range.</p>
              </span>
            </article>
            <article>
              <UsersRound aria-hidden="true" size={18} />
              <span>
                <small>Cover</small>
                <strong>{selectedPeak ? `${selectedPeak.required} people needed at peak` : "No cover model"}</strong>
                <p>{selectedGaps.length ? selectedGaps.map((gap) => `${gap.slotTime} (${gap.assigned}/${gap.required})`).slice(0, 4).join(", ") : "No modelled slot is below required cover."}</p>
              </span>
            </article>
            <article>
              <CloudRain aria-hidden="true" size={18} />
              <span>
                <small>Trading signals</small>
                <strong>{selectedWeather?.summary ?? "Weather unavailable"}</strong>
                <p>{selectedEvents.length ? selectedEvents.map((event) => event.title).slice(0, 2).join(" · ") : "No nearby event is currently loaded."}</p>
              </span>
            </article>
            <article>
              <Coffee aria-hidden="true" size={18} />
              <span>
                <small>Break plan</small>
                <strong>{selectedBreaks.filter((item) => item.startTime).length} suggested windows</strong>
                <p>
                  {selectedBreaks
                    .filter((item) => item.startTime)
                    .slice(0, 3)
                    .map((item) => {
                      const shift = selectedDay.shifts[item.shiftIndex];
                      return `${shift?.staffName ?? "Team member"} ${item.startTime}–${item.endTime}`;
                    })
                    .join(" · ") || "No break suggestion is required or a safe window needs manager judgement."}
                </p>
              </span>
            </article>
          </div>
        </section>
      ) : null}
    </section>
  );
}

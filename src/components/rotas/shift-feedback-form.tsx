"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import {
  saveRotaShiftFeedback,
  type RotaFeedbackActionState,
} from "@/app/actions/rota-feedback";

const initialState: RotaFeedbackActionState = { status: "idle", message: "" };

const periods = [
  ["prep", "Prep"],
  ["lunch", "Lunch"],
  ["afternoon", "Afternoon"],
  ["evening_peak", "Evening peak"],
  ["close", "Close"],
] as const;

const causes = [
  ["forecast_low", "Forecast too low"],
  ["forecast_high", "Forecast too high"],
  ["unexpected_walk_ins", "Unexpected walk-ins"],
  ["delivery_spike", "Delivery / order spike"],
  ["event_impact", "Event impact"],
  ["sickness", "Sickness / absence"],
  ["poor_deployment", "Poor deployment"],
  ["skill_mix", "Wrong skill mix"],
  ["prep_shortage", "Prep shortage"],
  ["equipment_issue", "Equipment issue"],
  ["left_early", "Someone left early"],
  ["stayed_late", "Someone stayed late"],
] as const;

const checkboxStyle = {
  alignItems: "center",
  gridTemplateColumns: "auto minmax(0, 1fr)",
} as const;

export function ShiftFeedbackForm({
  siteId,
  businessDate,
}: {
  siteId: string;
  businessDate: string;
}) {
  const [state, action, pending] = useActionState(saveRotaShiftFeedback, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="form-section stack">
      <input name="siteId" type="hidden" value={siteId} />
      <div>
        <p className="page-header__eyebrow">30-second learning loop</p>
        <h2>How did the shift feel?</h2>
        <p className="form-section__copy">Use operational judgement. The system compares this with actual sales, scheduled hours and worked hours rather than treating one note as fact.</p>
      </div>

      <label className="field">
        <span className="field__label">Shift date</span>
        <input className="field__input" defaultValue={businessDate} max={businessDate} name="businessDate" required type="date" />
      </label>

      <label className="field">
        <span className="field__label">Staffing level</span>
        <select className="field__input" defaultValue="about_right" name="staffingRating" required>
          <option value="very_under">Very understaffed</option>
          <option value="slightly_under">Slightly understaffed</option>
          <option value="about_right">About right</option>
          <option value="slightly_over">Slightly overstaffed</option>
          <option value="very_over">Very overstaffed</option>
        </select>
      </label>

      <fieldset className="field">
        <legend className="field__label">Affected period</legend>
        <div className="form-grid form-grid--three">
          {periods.map(([value, label]) => (
            <label className="field" key={value} style={checkboxStyle}>
              <input name="affectedPeriods" type="checkbox" value={value} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">What influenced it?</legend>
        <div className="form-grid form-grid--three">
          {causes.map(([value, label]) => (
            <label className="field" key={value} style={checkboxStyle}>
              <input name="causes" type="checkbox" value={value} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-grid form-grid--three">
        <label className="field">
          <span className="field__label">Left early</span>
          <input className="field__input" defaultValue="0" max="50" min="0" name="leftEarlyCount" required type="number" />
        </label>
        <label className="field">
          <span className="field__label">Stayed late</span>
          <input className="field__input" defaultValue="0" max="50" min="0" name="stayedLateCount" required type="number" />
        </label>
        <label className="field">
          <span className="field__label">Absent</span>
          <input className="field__input" defaultValue="0" max="50" min="0" name="absenceCount" required type="number" />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Service impact</span>
          <select className="field__input" defaultValue="none" name="serviceImpact" required>
            <option value="none">None</option>
            <option value="minor">Minor</option>
            <option value="major">Major</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Use this staffing again?</span>
          <select className="field__input" defaultValue="yes" name="wouldRepeat" required>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unsure">Unsure</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field__label">Shift note</span>
        <textarea className="field__input" maxLength={2000} name="notes" placeholder="What would you change next time?" rows={4} />
      </label>

      <button className="button button--primary" disabled={pending} type="submit">
        <MessageSquareText aria-hidden="true" size={16} />
        {pending ? "Saving feedback…" : "Save shift feedback"}
      </button>

      {state.status !== "idle" ? (
        <p
          className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

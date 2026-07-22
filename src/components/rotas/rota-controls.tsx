"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Sparkles } from "lucide-react";
import {
  generateRotaSuggestion,
  saveRotaForecastEvent,
  type RotaActionState,
} from "@/app/actions/rotas";

const initialState: RotaActionState = { status: "idle", message: "" };

export function RotaControls({
  siteId,
  weekStart,
  hasPlan,
}: {
  siteId: string;
  weekStart: string;
  hasPlan: boolean;
}) {
  const [generateState, generateAction, generating] = useActionState(
    generateRotaSuggestion,
    initialState,
  );
  const [eventState, eventAction, savingEvent] = useActionState(
    saveRotaForecastEvent,
    initialState,
  );
  const router = useRouter();

  useEffect(() => {
    if (generateState.status === "success" || eventState.status === "success") {
      router.refresh();
    }
  }, [eventState.status, generateState.status, router]);

  return (
    <section className="rota-launchbar panel">
      <div className="rota-launchbar__primary">
        <form action={generateAction}>
          <input name="siteId" type="hidden" value={siteId} />
          <input name="weekStart" type="hidden" value={weekStart} />
          <button className="button button--primary" disabled={generating} type="submit">
            <Sparkles aria-hidden="true" size={16} />
            {generating
              ? "Building the rota…"
              : hasPlan
                ? "Rebuild suggestion"
                : "Build this week’s rota"}
          </button>
        </form>
        <div className="rota-launchbar__copy">
          <strong>{hasPlan ? "The current suggestion stays available until the new one is ready." : "We will create a safe starting rota for you."}</strong>
          <small>Uses expected sales, hourly demand, availability, skills and agreed hours.</small>
        </div>
        {generateState.status !== "idle" ? (
          <p
            className={`form-message ${generateState.status === "error" ? "form-message--error" : "form-message--success"}`}
            role={generateState.status === "error" ? "alert" : "status"}
          >
            {generateState.message}
          </p>
        ) : null}
      </div>

      <details className="rota-launchbar__event">
        <summary><CalendarPlus aria-hidden="true" size={16} /> Add a special event or busy day</summary>
        <form action={eventAction} className="rota-launchbar__event-form">
          <input name="siteId" type="hidden" value={siteId} />
          <label className="field">
            <span className="field__label">Date</span>
            <input className="field__input" defaultValue={weekStart} name="eventDate" required type="date" />
          </label>
          <label className="field">
            <span className="field__label">What is happening?</span>
            <input className="field__input" maxLength={160} name="title" placeholder="Manchester home match" required />
          </label>
          <label className="field">
            <span className="field__label">Expected sales change</span>
            <div className="input-suffix">
              <input className="field__input" defaultValue="10" max="500" min="-90" name="salesUpliftPct" required step="0.1" type="number" />
              <span>%</span>
            </div>
          </label>
          <label className="field">
            <span className="field__label">Why do you expect this?</span>
            <input className="field__input" maxLength={1000} name="notes" placeholder="Bookings, event size or a similar previous day" />
          </label>
          <button className="button button--secondary" disabled={savingEvent} type="submit">
            {savingEvent ? "Saving…" : "Add to forecast"}
          </button>
          {eventState.status !== "idle" ? (
            <p
              className={`form-message ${eventState.status === "error" ? "form-message--error" : "form-message--success"}`}
              role={eventState.status === "error" ? "alert" : "status"}
            >
              {eventState.message}
            </p>
          ) : null}
        </form>
      </details>
    </section>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, LoaderCircle, RefreshCw } from "lucide-react";
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
  const [buildSeconds, setBuildSeconds] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!generating) {
      setBuildSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setBuildSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (generateState.status === "success" || eventState.status === "success") {
      router.refresh();
    }
  }, [eventState.status, generateState.status, router]);

  const buildProgress = buildSeconds < 3
    ? "Refreshing sales history, demand and team constraints…"
    : buildSeconds < 8
      ? "Recalculating recommended cover and agreed hours…"
      : buildSeconds < 20
        ? "Saving the latest planning overlay…"
        : "This is taking longer than expected. Your RotaCloud rota is untouched; wait a little longer or refresh and try again.";

  return (
    <section className="rota-launchbar panel">
      <div className="rota-launchbar__primary">
        <form action={generateAction}>
          <input name="siteId" type="hidden" value={siteId} />
          <input name="weekStart" type="hidden" value={weekStart} />
          <button className="button button--primary" disabled={generating} type="submit">
            {generating ? (
              <LoaderCircle aria-hidden="true" className="rota-copilot__spinner" size={16} />
            ) : (
              <RefreshCw aria-hidden="true" size={16} />
            )}
            {generating
              ? "Refreshing overlay…"
              : hasPlan
                ? "Refresh planning overlay"
                : "Create planning overlay"}
          </button>
        </form>
        <div className="rota-launchbar__copy">
          <strong>
            {hasPlan
              ? "Your current overlay stays visible until the refreshed one is ready."
              : "Create a forecast and staffing guide for the week."}
          </strong>
          <small>
            This does not create, edit or publish shifts in RotaCloud.
          </small>
        </div>
        {generating ? (
          <p aria-live="polite" className="form-message" role="status">
            {buildProgress} {buildSeconds > 0 ? `${buildSeconds}s` : ""}
          </p>
        ) : null}
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
        <summary>
          <CalendarPlus aria-hidden="true" size={16} /> Add a special event or busy day
        </summary>
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

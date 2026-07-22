"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  LayoutGrid,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { createBlankRotaDraft, type RotaStartActionState } from "@/app/actions/rota-start";
import {
  generateRotaSuggestion,
  saveRotaForecastEvent,
  type RotaActionState,
} from "@/app/actions/rotas";
import "./rota-controls.css";

const initialState: RotaActionState = { status: "idle", message: "" };
const initialStartState: RotaStartActionState = { status: "idle", message: "" };

export function RotaControls({
  siteId,
  weekStart,
  hasPlan,
}: {
  siteId: string;
  weekStart: string;
  hasPlan: boolean;
}) {
  const [blankState, blankAction, creatingBlank] = useActionState(createBlankRotaDraft, initialStartState);
  const [suggestionState, suggestionAction, generatingSuggestion] = useActionState(generateRotaSuggestion, initialState);
  const [eventState, eventAction, savingEvent] = useActionState(saveRotaForecastEvent, initialState);
  const router = useRouter();

  useEffect(() => {
    if (
      blankState.status === "success"
      || suggestionState.status === "success"
      || eventState.status === "success"
    ) {
      router.refresh();
    }
  }, [blankState.status, eventState.status, router, suggestionState.status]);

  const busy = creatingBlank || generatingSuggestion;
  const result = blankState.status !== "idle" ? blankState : suggestionState;

  return (
    <section className="rota-launchbar panel">
      <div className="rota-launchbar__primary">
        {!hasPlan ? (
          <form action={blankAction}>
            <input name="siteId" type="hidden" value={siteId} />
            <input name="weekStart" type="hidden" value={weekStart} />
            <button className="button button--primary" disabled={busy} type="submit">
              {creatingBlank ? <LoaderCircle className="rota-copilot__spinner" size={16} /> : <LayoutGrid size={16} />}
              {creatingBlank ? "Creating week…" : "Start blank rota week"}
            </button>
          </form>
        ) : (
          <div className="rota-launchbar__ready">
            <LayoutGrid size={18} />
            <span>
              <strong>The manager-built draft is ready below.</strong>
              <small>Add and edit shifts in the grid. Save the draft to refresh its score and AI review.</small>
            </span>
          </div>
        )}

        {!hasPlan ? (
          <div className="rota-launchbar__copy">
            <strong>Forecast and heat maps first. The KM decides every shift.</strong>
            <small>No automatic shifts are added unless you deliberately choose the optional starting template.</small>
          </div>
        ) : null}

        <details className="rota-launchbar__starter-tools">
          <summary><Sparkles size={16} /> Optional starting-point tools</summary>
          <div>
            <p>
              The suggested template is only a rough first draft. It must still be checked and edited by the kitchen manager.
            </p>
            {hasPlan ? (
              <p className="rota-launchbar__warning"><TriangleAlert size={15} /> Replacing the week creates a new version and supersedes the current draft.</p>
            ) : null}
            <div className="rota-launchbar__starter-actions">
              {hasPlan ? (
                <form action={blankAction}>
                  <input name="siteId" type="hidden" value={siteId} />
                  <input name="weekStart" type="hidden" value={weekStart} />
                  <button className="button button--secondary" disabled={busy} type="submit">
                    {creatingBlank ? "Resetting…" : "Reset to blank week"}
                  </button>
                </form>
              ) : null}
              <form action={suggestionAction}>
                <input name="siteId" type="hidden" value={siteId} />
                <input name="weekStart" type="hidden" value={weekStart} />
                <button className="button button--secondary" disabled={busy} type="submit">
                  {generatingSuggestion ? <LoaderCircle className="rota-copilot__spinner" size={16} /> : <Sparkles size={16} />}
                  {generatingSuggestion ? "Creating template…" : "Use suggested shift template"}
                </button>
              </form>
            </div>
          </div>
        </details>

        {result.status !== "idle" ? (
          <p className={`form-message ${result.status === "error" ? "form-message--error" : "form-message--success"}`} role={result.status === "error" ? "alert" : "status"}>
            {result.message}
          </p>
        ) : null}
      </div>

      <details className="rota-launchbar__event">
        <summary><CalendarPlus size={16} /> Add a special event or busy day</summary>
        <form action={eventAction} className="rota-launchbar__event-form">
          <input name="siteId" type="hidden" value={siteId} />
          <label className="field"><span className="field__label">Date</span><input className="field__input" defaultValue={weekStart} name="eventDate" required type="date" /></label>
          <label className="field"><span className="field__label">What is happening?</span><input className="field__input" maxLength={160} name="title" placeholder="Manchester home match" required /></label>
          <label className="field"><span className="field__label">Expected sales change</span><div className="input-suffix"><input className="field__input" defaultValue="10" max="500" min="-90" name="salesUpliftPct" required step="0.1" type="number" /><span>%</span></div></label>
          <label className="field"><span className="field__label">Why do you expect this?</span><input className="field__input" maxLength={1000} name="notes" placeholder="Bookings, event size or a similar previous day" /></label>
          <button className="button button--secondary" disabled={savingEvent} type="submit">{savingEvent ? "Saving…" : "Add to forecast"}</button>
          {eventState.status !== "idle" ? <p className={`form-message ${eventState.status === "error" ? "form-message--error" : "form-message--success"}`} role={eventState.status === "error" ? "alert" : "status"}>{eventState.message}</p> : null}
        </form>
      </details>
    </section>
  );
}

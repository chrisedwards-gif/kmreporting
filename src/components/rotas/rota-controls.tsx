"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Sparkles } from "lucide-react";
import { generateRotaSuggestion, saveRotaForecastEvent, type RotaActionState } from "@/app/actions/rotas";

const initialState: RotaActionState = { status: "idle", message: "" };

export function RotaControls({ siteId, weekStart }: { siteId: string; weekStart: string }) {
  const [generateState, generateAction, generating] = useActionState(generateRotaSuggestion, initialState);
  const [eventState, eventAction, savingEvent] = useActionState(saveRotaForecastEvent, initialState);
  const router = useRouter();
  useEffect(() => {
    if (generateState.status === "success" || eventState.status === "success") router.refresh();
  }, [eventState.status, generateState.status, router]);

  return (
    <div className="rota-controls">
      <form action={generateAction} className="rota-controls__generate">
        <input name="siteId" type="hidden" value={siteId} />
        <input name="weekStart" type="hidden" value={weekStart} />
        <button className="button button--primary" disabled={generating} type="submit"><Sparkles aria-hidden="true" size={16} />{generating ? "Calculating safe cover…" : "Generate rota suggestion"}</button>
        {generateState.status !== "idle" ? <p className={`form-message ${generateState.status === "error" ? "form-message--error" : "form-message--success"}`} role={generateState.status === "error" ? "alert" : "status"}>{generateState.message}</p> : null}
      </form>
      <details className="rota-controls__event panel">
        <summary><CalendarPlus aria-hidden="true" size={16} /> Add event or local uplift</summary>
        <form action={eventAction} className="rota-controls__event-form">
          <input name="siteId" type="hidden" value={siteId} />
          <label className="field"><span className="field__label">Date</span><input className="field__input" defaultValue={weekStart} name="eventDate" required type="date" /></label>
          <label className="field"><span className="field__label">Event</span><input className="field__input" maxLength={160} name="title" placeholder="Manchester home match" required /></label>
          <label className="field"><span className="field__label">Expected sales change</span><div className="input-suffix"><input className="field__input" defaultValue="10" max="500" min="-90" name="salesUpliftPct" required step="0.1" type="number" /><span>%</span></div></label>
          <label className="field"><span className="field__label">Evidence / note</span><input className="field__input" maxLength={1000} name="notes" placeholder="Booking pace, event capacity or prior comparable" /></label>
          <button className="button button--secondary" disabled={savingEvent} type="submit">{savingEvent ? "Saving…" : "Save forecast event"}</button>
          {eventState.status !== "idle" ? <p className={`form-message ${eventState.status === "error" ? "form-message--error" : "form-message--success"}`} role={eventState.status === "error" ? "alert" : "status"}>{eventState.message}</p> : null}
        </form>
      </details>
    </div>
  );
}

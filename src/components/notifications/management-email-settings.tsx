"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, Send, TestTube2 } from "lucide-react";
import {
  saveManagementEmailSettings,
  sendManagementSummaryNow,
  sendManagementSummaryTestEmail,
  type SummaryEmailState,
} from "@/app/actions/management-summary-email";

const initialState: SummaryEmailState = { status: "idle", message: "" };
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ManagementEmailSettings({
  settings,
  periods,
}: {
  settings: {
    recipientName: string;
    recipientEmail: string;
    enabled: boolean;
    sendDay: number;
    sendHour: number;
    allowPartial: boolean;
    lastSentAt: string | null;
  };
  periods: Array<{ id: string; label: string }>;
}) {
  const [settingsState, settingsAction, settingsPending] = useActionState(saveManagementEmailSettings, initialState);
  const [testState, testAction, testPending] = useActionState(sendManagementSummaryTestEmail, initialState);
  const [liveState, liveAction, livePending] = useActionState(sendManagementSummaryNow, initialState);
  const router = useRouter();

  useEffect(() => {
    if ([settingsState, testState, liveState].some((state) => state.status === "success")) router.refresh();
  }, [liveState, router, settingsState, testState]);

  const latestPeriod = periods[0]?.id ?? "";
  return (
    <div className="management-email-grid">
      <form action={settingsAction} className="report-form management-email-settings">
        <div className="form-grid form-grid--two">
          <label className="field"><span className="field__label">Recipient name</span><input className="field__input" defaultValue={settings.recipientName} name="recipientName" required /></label>
          <label className="field"><span className="field__label">Recipient email</span><input className="field__input" defaultValue={settings.recipientEmail} name="recipientEmail" placeholder="jake@vitagroup.com" required type="email" /></label>
          <label className="field"><span className="field__label">Send day</span><select className="field__input" defaultValue={settings.sendDay} name="sendDay">{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label className="field"><span className="field__label">Send time</span><select className="field__input" defaultValue={settings.sendHour} name="sendHour">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00 Europe/London</option>)}</select></label>
        </div>
        <label className="source-confirmation source-confirmation--standalone"><input defaultChecked={settings.enabled} name="enabled" type="checkbox" value="true" /><input name="enabled" type="hidden" value="false" /><span>Automatically send the latest management pack each week.</span></label>
        <label className="source-confirmation source-confirmation--standalone"><input defaultChecked={settings.allowPartial} name="allowPartial" type="checkbox" value="true" /><input name="allowPartial" type="hidden" value="false" /><span>Send a clearly labelled partial pack if at least one kitchen is approved but another is still outstanding.</span></label>
        {settingsState.status !== "idle" ? <ActionMessage state={settingsState} /> : null}
        <button className="button button--primary" disabled={settingsPending} type="submit"><MailCheck aria-hidden="true" size={16} />{settingsPending ? "Saving…" : "Save weekly email"}</button>
      </form>

      <div className="management-email-test-panel">
        <div><h3 className="form-subtitle">Delivery test</h3><p className="form-caption">Both actions generate the native A4 PDF, attach it and build the written management readout from the selected week.</p></div>
        <label className="field"><span className="field__label">Reporting week</span><select className="field__input" defaultValue={latestPeriod} id="management-email-period" name="periodId" form="management-email-test-form">{periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
        <form action={testAction} id="management-email-test-form"><button className="button button--secondary" disabled={testPending || !latestPeriod} type="submit"><TestTube2 aria-hidden="true" size={16} />{testPending ? "Sending…" : "Send full test to me"}</button></form>
        {testState.status !== "idle" ? <ActionMessage state={testState} /> : null}
        <form action={liveAction} className="management-email-live-form">
          <input name="periodId" type="hidden" value={latestPeriod} />
          <button className="button button--primary" disabled={livePending || !latestPeriod || !settings.recipientEmail} type="submit"><Send aria-hidden="true" size={16} />{livePending ? "Sending…" : `Send latest pack to ${settings.recipientName.split(" ")[0] || "recipient"}`}</button>
        </form>
        {liveState.status !== "idle" ? <ActionMessage state={liveState} /> : null}
        <p className="field__hint">{settings.lastSentAt ? `Last live delivery: ${new Date(settings.lastSentAt).toLocaleString("en-GB")}` : "No live management pack has been delivered yet."}</p>
      </div>
    </div>
  );
}

function ActionMessage({ state }: { state: SummaryEmailState }) {
  return <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>;
}

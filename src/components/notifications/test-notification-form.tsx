"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { sendTestNotification, type NotificationTestState } from "@/app/actions/notifications";

const initialState: NotificationTestState = { status: "idle", message: "" };

export function TestNotificationForm() {
  const [state, action, pending] = useActionState(sendTestNotification, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status !== "idle") router.refresh(); }, [router, state.status]);
  return (
    <form action={action} className="report-form">
      <label className="field"><span className="field__label">Test message</span><select className="field__input" defaultValue="report_initial" name="kind"><option value="report_initial">Monday initial reminder</option><option value="report_final">Monday final reminder</option><option value="approval_review">Tuesday approval reminder</option></select></label>
      <button className="button button--primary" disabled={pending} type="submit"><Send aria-hidden="true" size={16} />{pending ? "Testing…" : "Send test to me"}</button>
      {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div> : null}
    </form>
  );
}

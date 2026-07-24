"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { acknowledgeOneToOne, type OneToOneActionState } from "@/app/actions/one-to-one-acknowledgement";
import { ActionToast } from "@/components/ui/action-toast";

const initialState: OneToOneActionState = { status: "idle", message: "" };

export function ManagerAcknowledgementForm({ reviewId }: { reviewId: string }) {
  const [state, action, pending] = useActionState(acknowledgeOneToOne, initialState);
  const [response, setResponse] = useState("");

  return (
    <form action={action} className="manager-acknowledgement">
      <ActionToast errorTitle="Acknowledgement not recorded" state={state} successTitle="Review acknowledged" />
      <input name="reviewId" type="hidden" value={reviewId} />
      <label className="field">
        <span className="field__label">Your response or comments (optional)</span>
        <textarea className="field__input" maxLength={4000} name="response" onChange={(event) => setResponse(event.target.value)} rows={4} value={response} />
        <span className="field__hint">Your response is saved on the permanent review record.</span>
      </label>
      {state.status !== "idle" ? (
        <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>
          {state.status === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}
          {state.message}
        </div>
      ) : null}
      <button className="button button--primary" disabled={pending || state.status === "success"} type="submit">
        <Send aria-hidden="true" size={16} />
        {pending ? "Recording…" : state.status === "success" ? "Acknowledged" : "Acknowledge review"}
      </button>
    </form>
  );
}

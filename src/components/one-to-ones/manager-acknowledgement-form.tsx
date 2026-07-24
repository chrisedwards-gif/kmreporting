"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
import { ActionToast } from "@/components/ui/action-toast";

type OneToOneActionState = {
  status: "idle" | "error" | "success";
  message: string;
  reviewId?: string;
};

const initialState: OneToOneActionState = { status: "idle", message: "" };

export function ManagerAcknowledgementForm({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [state, setState] = useState<OneToOneActionState>(initialState);
  const [response, setResponse] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || state.status === "success") return;

    setPending(true);
    setState(initialState);
    try {
      const request = await fetch("/api/one-to-ones/acknowledge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, response }),
      });
      const result = await request.json().catch(() => ({
        status: "error",
        message: "The server returned an unreadable response. Your comment remains on this page.",
      })) as OneToOneActionState;

      setState(result);
      if (result.status === "success") router.refresh();
    } catch {
      setState({
        status: "error",
        message: "The acknowledgement could not reach the server. Your comment remains on this page so you can try again.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="manager-acknowledgement" onSubmit={submit}>
      <ActionToast errorTitle="Acknowledgement not recorded" state={state} successTitle="Review acknowledged" />
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

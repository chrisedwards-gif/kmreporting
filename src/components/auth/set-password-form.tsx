"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { updatePassword, type PasswordActionState } from "@/app/actions/auth";

const initialState: PasswordActionState = { status: "idle", message: "" };

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action} className="login__form">
      <label className="field">
        <span className="field__label">New password</span>
        <input
          autoComplete="new-password"
          autoFocus
          className="field__input"
          minLength={8}
          name="password"
          required
          type="password"
        />
        <span className="field__hint">At least 8 characters. A short phrase of three unrelated words is strong and easy to remember.</span>
      </label>
      <label className="field">
        <span className="field__label">Confirm new password</span>
        <input
          autoComplete="new-password"
          className="field__input"
          minLength={8}
          name="confirmPassword"
          required
          type="password"
        />
      </label>
      <button className="button button--primary" disabled={pending} type="submit">
        <KeyRound aria-hidden="true" size={16} />
        {pending ? "Saving…" : "Save password and continue"}
      </button>
      {state.status === "error" && (
        <div className="form-message form-message--error" role="alert">{state.message}</div>
      )}
    </form>
  );
}

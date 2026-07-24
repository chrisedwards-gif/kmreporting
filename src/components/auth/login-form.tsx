"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(initialError);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json().catch(() => ({ message: "Sign-in could not be completed." }));

      if (!response.ok) {
        setMessage(typeof result.message === "string" ? result.message : "Sign-in could not be completed.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setMessage("The sign-in service could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="login__form" onSubmit={submit}>
      {message ? <div className="privacy-callout login__message" role="alert">{message}</div> : null}
      <label className="field">
        <span className="field__label">Email address</span>
        <input autoComplete="email" className="field__input" name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input autoComplete="current-password" className="field__input" minLength={8} name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      </label>
      <button className="button button--primary" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in securely"}
      </button>
    </form>
  );
}

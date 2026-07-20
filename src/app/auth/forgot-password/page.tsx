import Link from "next/link";
import { ArrowLeft, ChefHat, MailCheck, MailQuestion } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/auth";

export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="login login--focused">
      <section className="login__form-wrap">
        <div className="login__card">
          <div className="app-shell__brand" style={{ marginBottom: "1.25rem" }}>
            <div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div>
            <div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div>
          </div>
          {sent ? (
            <>
              <MailCheck aria-hidden="true" color="#2f9e6e" size={24} />
              <h1>Check your inbox.</h1>
              <p>If that address has an account, a reset link is on its way. Open it on this device, choose a new password and you will land straight back in the app.</p>
              <Link className="button button--secondary" href="/login" style={{ width: "100%" }}>
                <ArrowLeft aria-hidden="true" size={16} /> Back to sign in
              </Link>
            </>
          ) : (
            <>
              <MailQuestion aria-hidden="true" color="#eb6b4f" size={24} />
              <h1>Reset your password.</h1>
              <p>Enter your work email and we will send a secure link to choose a new password.</p>
              {error && <div className="form-message form-message--error" role="alert" style={{ marginBottom: "1rem" }}>{error}</div>}
              <form action={requestPasswordReset} className="login__form">
                <label className="field">
                  <span className="field__label">Email address</span>
                  <input autoComplete="email" autoFocus className="field__input" name="email" required type="email" />
                </label>
                <button className="button button--primary" type="submit">Send reset link</button>
              </form>
              <div className="login__links">
                <Link href="/login">Back to sign in</Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

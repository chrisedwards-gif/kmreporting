import Link from "next/link";
import { ChefHat, LockKeyhole } from "lucide-react";
import { signIn } from "@/app/actions/auth";
import { environment } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <section className="login__story">
        <div className="app-shell__brand">
          <div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div>
          <div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div>
        </div>
        <h2 className="login__headline">Every kitchen.<br /><em>One clear week.</em></h2>
        <p>Consistent reporting, controlled costs and an approval trail before anything leaves the group.</p>
      </section>
      <section className="login__form-wrap">
        <div className="login__card">
          <LockKeyhole aria-hidden="true" color="#eb6b4f" size={24} />
          <h1>Welcome back.</h1>
          <p>Use your assigned account. Your role decides which kitchens and cost data you can access.</p>
          {error && <div className="privacy-callout" style={{ marginBottom: "1rem" }}>{error}</div>}
          <form action={signIn} className="login__form">
            <label className="field"><span className="field__label">Email address</span><input autoComplete="email" className="field__input" name="email" required type="email" /></label>
            <label className="field"><span className="field__label">Password</span><input autoComplete="current-password" className="field__input" minLength={8} name="password" required type="password" /></label>
            <button className="button button--primary" type="submit">Sign in securely</button>
          </form>
          <div style={{ display: "flex", justifyContent: "center", marginTop: "1.1rem" }}>
            <Link href="/auth/forgot-password" style={{ color: "var(--ink-600)", fontSize: ".82rem", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "3px" }}>Forgotten your password?</Link>
          </div>
          {environment.isDemo && <div className="login__demo"><Link className="button button--secondary" href="/dashboard" style={{ width: "100%" }}>View the demo workspace</Link></div>}
        </div>
      </section>
    </main>
  );
}

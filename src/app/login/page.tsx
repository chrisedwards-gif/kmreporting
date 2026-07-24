import Link from "next/link";
import { ChefHat, FlaskConical, LockKeyhole } from "lucide-react";
import { uatQuickLogin } from "@/app/actions/auth";
import { LoginForm } from "@/components/auth/login-form";
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
          <LoginForm initialError={error ?? ""} />
          <div className="login__links">
            <Link href="/auth/forgot-password">Forgotten your password?</Link>
          </div>
          {environment.uatQuickLoginEnabled ? (
            <div className="login__uat">
              <div className="login__uat-note"><FlaskConical aria-hidden="true" size={15} /><span>Preview only. Uses the dedicated UAT account and records an audit event.</span></div>
              <form action={uatQuickLogin}><button className="button button--secondary login__uat-button" type="submit">Continue as UAT administrator</button></form>
            </div>
          ) : null}
          {environment.isDemo && <div className="login__demo"><Link className="button button--secondary login__demo-button" href="/dashboard">View the demo workspace</Link></div>}
        </div>
      </section>
    </main>
  );
}

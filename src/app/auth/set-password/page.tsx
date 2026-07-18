import { redirect } from "next/navigation";
import { ChefHat, ShieldCheck } from "lucide-react";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  if (environment.isDemo) redirect("/dashboard");
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect("/login?error=Supabase+is+not+configured");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=Your+link+has+expired.+Request+a+new+one+below.");

  return (
    <main className="login" style={{ gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
      <section className="login__form-wrap" style={{ background: "transparent", padding: "2rem 1.25rem", width: "min(100%, 480px)" }}>
        <div className="login__card">
          <div className="app-shell__brand" style={{ marginBottom: "1.25rem" }}>
            <div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div>
            <div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div>
          </div>
          <ShieldCheck aria-hidden="true" color="#eb6b4f" size={24} />
          <h1>Choose your password.</h1>
          <p>You are signed in as <strong>{data.user.email}</strong>. Set a password now so you can sign in directly next week.</p>
          <SetPasswordForm />
        </div>
      </section>
    </main>
  );
}

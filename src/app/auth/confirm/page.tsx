import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChefHat, KeyRound, ShieldCheck } from "lucide-react";
import { confirmEmailOtp } from "@/app/actions/auth";
import { safeInternalPath } from "@/lib/utils";

export const metadata = { title: "Confirm your secure code" };
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["email", "invite", "recovery"]);

export default async function ConfirmAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; type?: string; next?: string; error?: string }>;
}) {
  const { email = "", type, next, error } = await searchParams;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    const requestHeaders = await headers();
    const currentHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
      ?? requestHeaders.get("host")?.split(",")[0]?.trim();
    const canonicalUrl = new URL(configuredOrigin);

    if (currentHost && currentHost !== canonicalUrl.host) {
      const target = new URL("/auth/confirm", canonicalUrl);
      if (email) target.searchParams.set("email", email);
      if (type) target.searchParams.set("type", type);
      if (next) target.searchParams.set("next", next);
      if (error) target.searchParams.set("error", error);
      redirect(target.toString());
    }
  }

  if (!type || !allowedTypes.has(type)) {
    redirect("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.");
  }

  const destination = safeInternalPath(next) ?? "/auth/set-password";
  const title = type === "recovery" ? "Enter your reset code." : "Enter your account code.";
  const description = type === "recovery"
    ? "Use the one-time code in your password-reset email."
    : "Use the one-time code in your invitation or confirmation email.";

  return (
    <main className="login" style={{ gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
      <section className="login__form-wrap" style={{ background: "transparent", padding: "2rem 1.25rem", width: "min(100%, 500px)" }}>
        <div className="login__card">
          <div className="app-shell__brand" style={{ marginBottom: "1.25rem" }}>
            <div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div>
            <div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div>
          </div>
          <ShieldCheck aria-hidden="true" color="#eb6b4f" size={26} />
          <h1>{title}</h1>
          <p>{description}</p>
          {error && <div className="form-message form-message--error" role="alert">{error}</div>}
          <form action={confirmEmailOtp} className="login__form">
            <label className="field">
              <span className="field__label">Email address</span>
              <input
                autoComplete="email"
                className="field__input"
                defaultValue={email}
                name="email"
                required
                type="email"
              />
            </label>
            <label className="field">
              <span className="field__label">One-time code</span>
              <input
                autoComplete="one-time-code"
                autoFocus
                className="field__input"
                inputMode="numeric"
                maxLength={10}
                minLength={6}
                name="token"
                pattern="[0-9]{6,10}"
                placeholder="Enter the code from the email"
                required
                type="text"
              />
              <span className="field__hint">The code can only be used once and expires shortly.</span>
            </label>
            <input name="type" type="hidden" value={type} />
            <input name="next" type="hidden" value={destination} />
            <button className="button button--primary" type="submit">
              <KeyRound aria-hidden="true" size={16} /> Confirm code and continue
            </button>
          </form>
          <p className="field__hint" style={{ marginTop: "1rem" }}>
            The code is kept out of the link so automated email-security scanners cannot use it before you do.
          </p>
        </div>
      </section>
    </main>
  );
}

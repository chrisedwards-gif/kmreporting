import { redirect } from "next/navigation";
import { ChefHat, ShieldCheck } from "lucide-react";
import { confirmEmailToken } from "@/app/actions/auth";
import { safeInternalPath } from "@/lib/utils";

export const metadata = { title: "Confirm your secure link" };
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["email", "invite", "recovery"]);

export default async function ConfirmAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  if (!tokenHash || tokenHash.length < 20 || !type || !allowedTypes.has(type)) {
    redirect("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.");
  }

  const destination = safeInternalPath(next) ?? "/dashboard";
  const title = type === "recovery" ? "Continue to reset your password." : "Continue to finish setting up your account.";
  const description = type === "recovery"
    ? "For your protection, the reset is not completed until you press the button below."
    : "For your protection, the invitation is not accepted until you press the button below.";

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
          <form action={confirmEmailToken} className="login__form">
            <input name="tokenHash" type="hidden" value={tokenHash} />
            <input name="type" type="hidden" value={type} />
            <input name="next" type="hidden" value={destination} />
            <button className="button button--primary" type="submit">
              Confirm and continue
            </button>
          </form>
          <p className="field__hint" style={{ marginTop: "1rem" }}>
            This extra step prevents automated email-security scanners from using your one-time link before you do.
          </p>
        </div>
      </section>
    </main>
  );
}

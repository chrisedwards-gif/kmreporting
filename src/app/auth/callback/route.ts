import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/utils";

const allowedEmailOtpTypes = new Set<EmailOtpType>(["email", "invite", "recovery"]);

// PKCE callbacks can be exchanged immediately. Token-hash links are forwarded
// to a confirmation page and only verified after a human POSTs the form, which
// prevents Microsoft Safe Links from consuming them during email scanning.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalPath(request.nextUrl.searchParams.get("next")) ?? "/dashboard";
  const canonicalOrigin = await getRequestOrigin() ?? request.nextUrl.origin;

  if (tokenHash && requestedType && allowedEmailOtpTypes.has(requestedType)) {
    const confirmationUrl = new URL("/auth/confirm", canonicalOrigin);
    confirmationUrl.searchParams.set("token_hash", tokenHash);
    confirmationUrl.searchParams.set("type", requestedType);
    confirmationUrl.searchParams.set("next", next);
    return NextResponse.redirect(confirmationUrl);
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, canonicalOrigin));
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.", canonicalOrigin),
  );
}

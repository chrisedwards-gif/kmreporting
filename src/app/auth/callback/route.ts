import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/utils";

const allowedEmailOtpTypes = new Set<EmailOtpType>(["email", "invite", "recovery"]);

// Handles Supabase email links. Password recovery can arrive as a PKCE code.
// Invitations should use the documented token-hash email template because the
// administrator and invitee normally use different browsers.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalPath(request.nextUrl.searchParams.get("next")) ?? "/dashboard";
  const supabase = await createServerSupabaseClient();

  if (supabase) {
    if (tokenHash && requestedType && allowedEmailOtpTypes.has(requestedType)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: requestedType });
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.", request.url),
  );
}

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/http";

const allowedTypes = new Set<EmailOtpType>(["invite", "recovery", "email"]);
const tokenPattern = /^[A-Za-z0-9_-]{20,512}$/;

/**
 * Compatibility shim for legacy/broken Supabase email templates that build
 * `/auth/v1/verify` on the application host instead of the Supabase project
 * host. We never trust the incoming redirect_to value; the app chooses the
 * canonical callback itself.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const appOrigin = await getRequestOrigin() ?? request.nextUrl.origin;

  if (!supabaseUrl || !type || !allowedTypes.has(type) || !tokenPattern.test(token)) {
    return NextResponse.redirect(
      new URL("/login?error=That+invitation+link+is+invalid+or+has+expired.+Request+a+new+one.", appOrigin),
    );
  }

  const verifyUrl = new URL("/auth/v1/verify", supabaseUrl);
  verifyUrl.searchParams.set("token", token);
  verifyUrl.searchParams.set("type", type);

  const next = type === "invite" || type === "recovery" ? "/auth/set-password" : "/dashboard";
  const callbackUrl = new URL("/auth/callback", appOrigin);
  callbackUrl.searchParams.set("next", next);
  verifyUrl.searchParams.set("redirect_to", callbackUrl.toString());

  return NextResponse.redirect(verifyUrl, 307);
}

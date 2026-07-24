import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Enter your email address and password." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Enter a valid email address and password." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ message: "The sign-in service is unavailable." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    console.error("auth.password_sign_in_failed", {
      code: error?.code ?? "missing_user",
      message: error?.message ?? "No user returned",
    });
    return NextResponse.json({ message: "Sign-in failed. Check your email and password." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}

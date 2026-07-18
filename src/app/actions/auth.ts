"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";
import { environment } from "@/lib/env";
import { getRequestOrigin } from "@/lib/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/utils";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function signIn(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=Enter+a+valid+email+and+password");
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect("/login?error=Supabase+is+not+configured");
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect("/login?error=Sign-in+failed.+Check+your+email+and+password.");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

const resetSchema = z.object({ email: z.email() });

export async function requestPasswordReset(formData: FormData) {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/auth/forgot-password?error=Enter+a+valid+email+address");
  if (environment.isDemo) redirect("/auth/forgot-password?error=Password+reset+is+unavailable+in+the+demo+workspace");

  const supabase = await createServerSupabaseClient();
  const origin = await getRequestOrigin();
  if (supabase && origin) {
    // The response is identical whether or not the address has an account,
    // so this form cannot be used to enumerate valid emails.
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
    });
  }
  redirect("/auth/forgot-password?sent=1");
}

const confirmTokenSchema = z.object({
  tokenHash: z.string().min(20).max(2048),
  type: z.enum(["email", "invite", "recovery"]),
  next: z.string().max(200).optional(),
});

// Verification is intentionally a POST action. Microsoft Safe Links and other
// email scanners may prefetch GET links; requiring a human button press keeps
// them from consuming Supabase's one-time token before the recipient arrives.
export async function confirmEmailToken(formData: FormData) {
  const parsed = confirmTokenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.");

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect("/login?error=The+database+connection+is+unavailable.");

  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.tokenHash,
    type: parsed.data.type as EmailOtpType,
  });
  if (error) redirect("/login?error=That+link+is+invalid+or+has+expired.+Request+a+new+one.");

  redirect(safeInternalPath(parsed.data.next) ?? "/dashboard");
}

export type PasswordActionState = { status: "idle" | "error"; message: string };

const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Both password fields must match.",
    path: ["confirmPassword"],
  });

export async function updatePassword(
  _previous: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the password fields." };
  }
  if (environment.isDemo) {
    return { status: "error", message: "Passwords cannot be changed in the demo workspace." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?error=Your+link+has+expired.+Request+a+new+one+below.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      status: "error",
      message: error.message.includes("different from the old")
        ? "Choose a password you have not used before."
        : "The password could not be saved. Try a longer, less common password.",
    };
  }
  redirect("/dashboard");
}

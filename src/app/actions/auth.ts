"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  if (error) redirect("/login?error=Sign-in+failed");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

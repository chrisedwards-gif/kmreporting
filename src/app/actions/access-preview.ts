"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accessPreviewCookieName, requireActualRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const previewSchema = z.object({ siteId: z.uuid() });

export async function startAccessPreview(formData: FormData) {
  const profile = await requireActualRole(["admin"]);
  const parsed = previewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard?preview=invalid");

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect("/dashboard?preview=unavailable");
  const { data: site } = await supabase
    .from("sites")
    .select("id")
    .eq("id", parsed.data.siteId)
    .eq("organisation_id", profile.organisationId)
    .maybeSingle();
  if (!site) redirect("/dashboard?preview=invalid");

  const cookieStore = await cookies();
  cookieStore.set(accessPreviewCookieName, site.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.isProduction,
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  redirect("/dashboard");
}

export async function clearAccessPreview() {
  await requireActualRole(["admin"]);
  const cookieStore = await cookies();
  cookieStore.delete(accessPreviewCookieName);
  redirect("/dashboard");
}

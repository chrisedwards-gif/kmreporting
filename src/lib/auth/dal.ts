import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

type SessionProfile = {
  id: string;
  organisationId: string;
  fullName: string;
  role: AppRole;
};

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (environment.isDemo) {
    return { id: "demo-user", organisationId: "demo-org", fullName: "Chris", role: "group_manager" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organisation_id, full_name, role")
    .eq("id", authData.user.id)
    .eq("active", true)
    .single();

  if (profileError || !profile) return null;
  return {
    id: profile.id,
    organisationId: profile.organisation_id,
    fullName: profile.full_name,
    role: profile.role as AppRole,
  };
});

export const requireSessionProfile = cache(async () => {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
});

export async function requireRole(allowed: AppRole[]) {
  const profile = await requireSessionProfile();
  if (!allowed.includes(profile.role)) redirect("/dashboard");
  return profile;
}

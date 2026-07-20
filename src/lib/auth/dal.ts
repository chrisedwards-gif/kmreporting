import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export const accessPreviewCookieName = "hos_access_preview_site";

export type SessionProfile = {
  id: string;
  organisationId: string;
  fullName: string;
  /** Canonical role used for navigation, page guards and write permissions. */
  role: AppRole;
  /** Canonical database role attached to the authenticated profile. */
  actualRole: AppRole;
  /** True when an Admin has selected a kitchen-scoped operating context. */
  isAccessPreview: boolean;
  previewSiteId: string | null;
  previewSiteName: string | null;
  previewManagerId: string | null;
  previewManagerName: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (environment.isDemo) {
    return {
      id: "demo-user",
      organisationId: "demo-org",
      fullName: "Chris",
      role: "group_manager",
      actualRole: "group_manager",
      isAccessPreview: false,
      previewSiteId: null,
      previewSiteName: null,
      previewManagerId: null,
      previewManagerName: null,
    };
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

  const actualRole = profile.role as AppRole;
  let previewSiteId: string | null = null;
  let previewSiteName: string | null = null;
  let previewManagerId: string | null = null;
  let previewManagerName: string | null = null;

  if (actualRole === "admin") {
    const cookieStore = await cookies();
    const requestedSiteId = cookieStore.get(accessPreviewCookieName)?.value ?? "";
    if (uuidPattern.test(requestedSiteId)) {
      const { data: site } = await supabase
        .from("sites")
        .select("id, name")
        .eq("id", requestedSiteId)
        .eq("organisation_id", profile.organisation_id)
        .maybeSingle();

      if (site) {
        previewSiteId = site.id;
        previewSiteName = site.name;
        const { data: assignment } = await supabase
          .from("site_manager_assignments")
          .select("manager_profile_id")
          .eq("site_id", site.id)
          .is("ends_on", null)
          .maybeSingle();
        if (assignment?.manager_profile_id) {
          previewManagerId = assignment.manager_profile_id;
          const { data: manager } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", assignment.manager_profile_id)
            .maybeSingle();
          previewManagerName = manager?.full_name ?? null;
        }
      }
    }
  }

  const isAccessPreview = Boolean(previewSiteId);
  return {
    id: profile.id,
    organisationId: profile.organisation_id,
    fullName: profile.full_name,
    role: actualRole,
    actualRole,
    isAccessPreview,
    previewSiteId,
    previewSiteName,
    previewManagerId,
    previewManagerName,
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

export async function requireActualRole(allowed: AppRole[]) {
  const profile = await requireSessionProfile();
  if (!allowed.includes(profile.actualRole)) redirect("/dashboard");
  return profile;
}

export async function getAdminPreviewSites(): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const profile = await requireSessionProfile();
  if (profile.actualRole !== "admin") return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("sites")
    .select("id, name, active")
    .eq("organisation_id", profile.organisationId)
    .order("active", { ascending: false })
    .order("name");
  return data ?? [];
}

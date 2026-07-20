import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { capabilitiesFor, navigationRoleFor, type Capabilities } from "@/lib/auth/capabilities";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export const accessPreviewCookieName = "hos_access_preview_site";
export const demoPersonaCookieName = "hos_demo_persona";

export type SessionProfile = {
  id: string;
  organisationId: string;
  fullName: string;
  /** Canonical database role used by route guards and server actions. */
  role: AppRole;
  actualRole: AppRole;
  /** Workspace role used only for navigation and view-specific presentation. */
  navigationRole: AppRole;
  /** True when an Admin is inspecting a kitchen-scoped manager workspace. */
  isAccessPreview: boolean;
  previewSiteId: string | null;
  previewSiteName: string | null;
  previewManagerId: string | null;
  previewManagerName: string | null;
  /**
   * Null means group scope. A populated array is the complete operational site
   * boundary for this request. Admin kitchen mode and Kitchen Manager accounts
   * both use this same boundary, so cross-kitchen data cannot leak through a
   * page that forgot to inspect previewSiteId.
   */
  siteScopeIds: string[] | null;
  /** The manager identity whose personal workspace is being shown. */
  scopeManagerId: string | null;
  /** Centralised write powers derived from actualRole only. */
  capabilities: Capabilities;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const demoKardiaId = "00000000-0000-4000-8000-000000000003";

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (environment.isDemo) {
    const cookieStore = await cookies();
    const requestedPersona = cookieStore.get(demoPersonaCookieName)?.value;
    const actualRole: AppRole = requestedPersona === "kitchen_manager" || requestedPersona === "viewer" || requestedPersona === "admin"
      ? requestedPersona
      : "admin";
    const isKitchenManager = actualRole === "kitchen_manager";
    return {
      id: isKitchenManager ? "demo-manager-kardia" : `demo-${actualRole}`,
      organisationId: "demo-org",
      fullName: isKitchenManager ? "Scott Hutton" : actualRole === "viewer" ? "Jake Viewer" : "Chris Edwards",
      role: actualRole,
      actualRole,
      navigationRole: actualRole,
      isAccessPreview: false,
      previewSiteId: null,
      previewSiteName: null,
      previewManagerId: null,
      previewManagerName: null,
      siteScopeIds: isKitchenManager ? [demoKardiaId] : null,
      scopeManagerId: isKitchenManager ? "demo-manager-kardia" : null,
      capabilities: capabilitiesFor(actualRole),
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
          .order("starts_on", { ascending: false })
          .limit(1)
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
  let siteScopeIds: string[] | null = null;
  if (previewSiteId) {
    siteScopeIds = [previewSiteId];
  } else if (actualRole === "kitchen_manager") {
    const { data: memberships } = await supabase
      .from("site_memberships")
      .select("site_id")
      .eq("user_id", profile.id);
    siteScopeIds = [...new Set((memberships ?? []).map((membership) => membership.site_id))];
  }

  const scopeManagerId = previewManagerId ?? (actualRole === "kitchen_manager" ? profile.id : null);

  return {
    id: profile.id,
    organisationId: profile.organisation_id,
    fullName: profile.full_name,
    role: actualRole,
    actualRole,
    navigationRole: navigationRoleFor(actualRole, isAccessPreview),
    isAccessPreview,
    previewSiteId,
    previewSiteName,
    previewManagerId,
    previewManagerName,
    siteScopeIds,
    scopeManagerId,
    capabilities: capabilitiesFor(actualRole),
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

/** Group-only pages must not remain directly reachable during Admin kitchen mode. */
export async function requireGroupWorkspaceRole(allowed: AppRole[]) {
  const profile = await requireRole(allowed);
  if (profile.isAccessPreview) redirect("/dashboard");
  return profile;
}

export async function getAdminPreviewSites(): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const profile = await requireSessionProfile();
  if (!profile.capabilities.admin) return [];
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

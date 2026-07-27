import "server-only";

import { environment } from "@/lib/env";
import type { PerformanceActionTarget } from "@/lib/performance/action-targets";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type MembershipRow = { user_id: string; site_id: string };
type AssignmentRow = { id: string; manager_profile_id: string; site_id: string };

const demoTargets: PerformanceActionTarget[] = [{
  assignmentId: "00000000-0000-4000-8000-000000000201",
  managerId: "demo-manager-kardia",
  managerName: "Scott Hutton",
  siteId: "kardia",
  siteName: "Kardia",
}];

export async function getPerformanceActionTargets(): Promise<PerformanceActionTarget[]> {
  if (environment.isDemo) return demoTargets;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const [{ data: memberships, error: membershipError }, { data: assignments, error: assignmentError }] = await Promise.all([
    supabase.from("site_memberships").select("user_id, site_id"),
    supabase
      .from("site_manager_assignments")
      .select("id, manager_profile_id, site_id")
      .is("ends_on", null),
  ]);
  if (membershipError || assignmentError) return [];

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const assignmentRows = (assignments ?? []) as AssignmentRow[];
  const managerIds = [...new Set([
    ...membershipRows.map((row) => row.user_id),
    ...assignmentRows.map((row) => row.manager_profile_id),
  ])];
  const siteIds = [...new Set([
    ...membershipRows.map((row) => row.site_id),
    ...assignmentRows.map((row) => row.site_id),
  ])];
  if (!managerIds.length || !siteIds.length) return [];

  const [{ data: profiles }, { data: sites }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", managerIds)
      .eq("role", "kitchen_manager")
      .eq("active", true),
    supabase.from("sites").select("id, name").in("id", siteIds).eq("active", true),
  ]);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const siteMap = new Map((sites ?? []).map((site) => [site.id, site.name]));
  const assignmentMap = new Map(
    assignmentRows.map((assignment) => [
      `${assignment.manager_profile_id}:${assignment.site_id}`,
      assignment.id,
    ]),
  );
  const targetMap = new Map<string, PerformanceActionTarget>();

  for (const row of [...membershipRows, ...assignmentRows.map((assignment) => ({
    user_id: assignment.manager_profile_id,
    site_id: assignment.site_id,
  }))]) {
    const managerName = profileMap.get(row.user_id);
    const siteName = siteMap.get(row.site_id);
    if (!managerName || !siteName) continue;
    const key = `${row.user_id}:${row.site_id}`;
    targetMap.set(key, {
      assignmentId: assignmentMap.get(key) ?? null,
      managerId: row.user_id,
      managerName,
      siteId: row.site_id,
      siteName,
    });
  }

  return [...targetMap.values()].sort((left, right) => (
    left.siteName.localeCompare(right.siteName) || left.managerName.localeCompare(right.managerName)
  ));
}

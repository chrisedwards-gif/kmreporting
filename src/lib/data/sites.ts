import "server-only";

import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SiteManagerSummary = {
  assignmentId: string;
  profileId: string;
  fullName: string;
  email: string;
  startsOn: string;
  endsOn: string | null;
};

export type AdditionalSiteManager = {
  profileId: string;
  fullName: string;
  email: string;
  canSubmit: boolean;
};

export type SiteUsageSummary = {
  reports: number;
  dailyRecords: number;
  checks: number;
  peopleRecords: number;
  sops: number;
  training: number;
  products: number;
  messages: number;
  payrollRecords: number;
  totalDependencies: number;
};

export type ManagedSiteDirectoryItem = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  reportingStartDate: string;
  reportingEndDate: string | null;
  foodCostTarget: number;
  labourTarget: number;
  wasteTarget: number;
  primaryManager: SiteManagerSummary | null;
  managerHistory: SiteManagerSummary[];
  additionalManagers: AdditionalSiteManager[];
  usage: SiteUsageSummary;
  canDelete: boolean;
};

type UsageRow = {
  site_id: string;
  reports: number | string;
  daily_records: number | string;
  checks: number | string;
  people_records: number | string;
  sops: number | string;
  training: number | string;
  products: number | string;
  messages: number | string;
  payroll_records: number | string;
  total_dependencies: number | string;
};

const emptyUsage = (): SiteUsageSummary => ({
  reports: 0,
  dailyRecords: 0,
  checks: 0,
  peopleRecords: 0,
  sops: 0,
  training: 0,
  products: 0,
  messages: 0,
  payrollRecords: 0,
  totalDependencies: 0,
});

export async function getManagedSiteDirectory(): Promise<ManagedSiteDirectoryItem[]> {
  if (environment.isDemo) {
    return [
      {
        id: "00000000-0000-4000-8000-000000000001",
        code: "DR-MCR",
        name: "Dough Religion",
        active: true,
        reportingStartDate: "2026-05-03",
        reportingEndDate: null,
        foodCostTarget: 30,
        labourTarget: 32,
        wasteTarget: 1.2,
        primaryManager: {
          assignmentId: "00000000-0000-4000-8000-000000000201",
          profileId: "00000000-0000-4000-8000-000000000101",
          fullName: "Warren Raisbeck",
          email: "warren@example.test",
          startsOn: "2026-05-03",
          endsOn: null,
        },
        managerHistory: [],
        additionalManagers: [],
        usage: { ...emptyUsage(), reports: 12, dailyRecords: 84, peopleRecords: 1, totalDependencies: 97 },
        canDelete: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        code: "CW-MCR",
        name: "Choi Wan",
        active: false,
        reportingStartDate: "2026-05-03",
        reportingEndDate: "2026-07-12",
        foodCostTarget: 31,
        labourTarget: 32,
        wasteTarget: 1.2,
        primaryManager: null,
        managerHistory: [],
        additionalManagers: [],
        usage: emptyUsage(),
        canDelete: true,
      },
    ];
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("id, code, name, active, reporting_start_date, reporting_end_date, food_cost_target, labour_target, waste_target")
    .order("active", { ascending: false })
    .order("name");
  if (sitesError || !sites) return [];

  const siteIds = sites.map((site) => site.id);
  const [{ data: assignments, error: assignmentError }, { data: memberships }, { data: usageRows, error: usageError }] = await Promise.all([
    siteIds.length
      ? supabase.from("site_manager_assignments").select("id, site_id, manager_profile_id, starts_on, ends_on").in("site_id", siteIds).order("starts_on", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? supabase.from("site_memberships").select("site_id, user_id, can_submit").in("site_id", siteIds)
      : Promise.resolve({ data: [] }),
    supabase.rpc("get_site_usage_summary"),
  ]);

  const usageBySite = new Map<string, SiteUsageSummary>();
  for (const row of (usageRows ?? []) as UsageRow[]) {
    const usage = {
      reports: Number(row.reports),
      dailyRecords: Number(row.daily_records),
      checks: Number(row.checks),
      peopleRecords: Number(row.people_records),
      sops: Number(row.sops),
      training: Number(row.training),
      products: Number(row.products),
      messages: Number(row.messages),
      payrollRecords: Number(row.payroll_records),
      totalDependencies: Number(row.total_dependencies),
    };
    usageBySite.set(row.site_id, usage);
  }

  if (assignmentError) {
    return sites.map((site) => {
      const usage = usageBySite.get(site.id) ?? emptyUsage();
      return {
        id: site.id,
        code: site.code,
        name: site.name,
        active: site.active,
        reportingStartDate: site.reporting_start_date,
        reportingEndDate: site.reporting_end_date,
        foodCostTarget: Number(site.food_cost_target),
        labourTarget: Number(site.labour_target),
        wasteTarget: Number(site.waste_target),
        primaryManager: null,
        managerHistory: [],
        additionalManagers: [],
        usage,
        canDelete: !usageError && usage.totalDependencies === 0,
      };
    });
  }

  const profileIds = [...new Set([
    ...(assignments ?? []).map((item) => item.manager_profile_id),
    ...(memberships ?? []).map((item) => item.user_id),
  ])];
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name, notification_email, role, active").in("id", profileIds)
    : { data: [] };
  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const summariesBySite = new Map<string, SiteManagerSummary[]>();

  for (const assignment of assignments ?? []) {
    const profile = profilesById.get(assignment.manager_profile_id);
    if (!profile) continue;
    const current = summariesBySite.get(assignment.site_id) ?? [];
    current.push({
      assignmentId: assignment.id,
      profileId: profile.id,
      fullName: profile.full_name,
      email: profile.notification_email ?? "",
      startsOn: assignment.starts_on,
      endsOn: assignment.ends_on,
    });
    summariesBySite.set(assignment.site_id, current);
  }

  return sites.map((site) => {
    const assignmentHistory = summariesBySite.get(site.id) ?? [];
    const primaryManager = assignmentHistory.find((item) => item.endsOn === null) ?? null;
    const additionalManagers = (memberships ?? [])
      .filter((membership) => membership.site_id === site.id && membership.user_id !== primaryManager?.profileId)
      .flatMap((membership) => {
        const profile = profilesById.get(membership.user_id);
        if (!profile || profile.role !== "kitchen_manager" || !profile.active) return [];
        return [{
          profileId: profile.id,
          fullName: profile.full_name,
          email: profile.notification_email ?? "",
          canSubmit: Boolean(membership.can_submit),
        }];
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const usage = usageBySite.get(site.id) ?? emptyUsage();
    return {
      id: site.id,
      code: site.code,
      name: site.name,
      active: site.active,
      reportingStartDate: site.reporting_start_date,
      reportingEndDate: site.reporting_end_date,
      foodCostTarget: Number(site.food_cost_target),
      labourTarget: Number(site.labour_target),
      wasteTarget: Number(site.waste_target),
      primaryManager,
      managerHistory: assignmentHistory.filter((item) => item.endsOn !== null).slice(0, 8),
      additionalManagers,
      usage,
      canDelete: !usageError && usage.totalDependencies === 0,
    };
  });
}

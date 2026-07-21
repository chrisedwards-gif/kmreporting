import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SalarySite = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  includeSalaryCosts: boolean;
};

export type SalaryProfile = {
  id: string;
  fullName: string;
  email: string;
};

export type SalaryAllocation = {
  id: string;
  siteId: string;
  siteName: string;
  profileId: string | null;
  staffName: string;
  roleTitle: string;
  annualSalary: number;
  oncostRate: number;
  allocationPct: number;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  weeklyBaseCost: number;
  weeklyOncost: number;
  weeklyLoadedCost: number;
};

type DbSalaryAllocation = {
  id: string;
  site_id: string;
  site_name: string;
  profile_id: string | null;
  staff_name: string;
  role_title: string;
  annual_salary: number | string;
  oncost_rate: number | string;
  allocation_pct: number | string;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  weekly_base_cost: number | string;
  weekly_oncost: number | string;
  weekly_loaded_cost: number | string;
};

export async function getSalaryWorkspace(): Promise<{
  sites: SalarySite[];
  profiles: SalaryProfile[];
  allocations: SalaryAllocation[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { sites: [], profiles: [], allocations: [] };
  const [{ data: rawSites = [] }, { data: rawProfiles = [] }, { data: rawAllocations = [] }] = await Promise.all([
    supabase.from("sites").select("id, name, code, active, include_salary_costs").order("active", { ascending: false }).order("name"),
    supabase.from("profiles").select("id, full_name, notification_email").eq("active", true).order("full_name"),
    supabase.rpc("get_salary_allocations"),
  ]);
  return {
    sites: (rawSites ?? []).map((site) => ({
      id: site.id,
      name: site.name,
      code: site.code,
      active: Boolean(site.active),
      includeSalaryCosts: Boolean(site.include_salary_costs),
    })),
    profiles: (rawProfiles ?? []).map((profile) => ({
      id: profile.id,
      fullName: profile.full_name,
      email: profile.notification_email ?? "",
    })),
    allocations: ((rawAllocations ?? []) as DbSalaryAllocation[]).map((allocation) => ({
      id: allocation.id,
      siteId: allocation.site_id,
      siteName: allocation.site_name,
      profileId: allocation.profile_id,
      staffName: allocation.staff_name,
      roleTitle: allocation.role_title,
      annualSalary: Number(allocation.annual_salary),
      oncostRate: Number(allocation.oncost_rate),
      allocationPct: Number(allocation.allocation_pct),
      validFrom: allocation.valid_from,
      validTo: allocation.valid_to,
      active: Boolean(allocation.active),
      weeklyBaseCost: Number(allocation.weekly_base_cost),
      weeklyOncost: Number(allocation.weekly_oncost),
      weeklyLoadedCost: Number(allocation.weekly_loaded_cost),
    })),
  };
}

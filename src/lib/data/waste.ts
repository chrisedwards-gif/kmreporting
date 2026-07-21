import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type WasteSite = { id: string; name: string; code: string; active: boolean };
export type WasteEntry = {
  id: string;
  siteId: string;
  siteName: string;
  businessDate: string;
  itemName: string;
  category: string;
  reason: string;
  quantity: number | null;
  unit: string | null;
  estimatedCost: number;
  notes: string;
  loggedBy: string;
  reportId: string | null;
  capturedAt: string | null;
  createdAt: string;
};

export async function getWasteWorkspace(profile: SessionProfile): Promise<{ sites: WasteSite[]; entries: WasteEntry[] }> {
  if (environment.isDemo) {
    const sites = [
      { id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR", active: true },
      { id: "00000000-0000-4000-8000-000000000003", name: "Kardia", code: "KAR-MCR", active: true },
    ].filter((site) => profile.siteScopeIds === null || scopeContainsSite(profile.siteScopeIds, site.id));
    return {
      sites,
      entries: sites.length ? [{
        id: "demo-waste",
        siteId: sites[0].id,
        siteName: sites[0].name,
        businessDate: "2026-07-20",
        itemName: "Pizza dough",
        category: "Food",
        reason: "Overproduction",
        quantity: 3,
        unit: "balls",
        estimatedCost: 4.5,
        notes: "End of service",
        loggedBy: "Warren",
        reportId: null,
        capturedAt: null,
        createdAt: "2026-07-20T22:00:00Z",
      }] : [],
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { sites: [], entries: [] };
  const { data: rawSites = [] } = await supabase.from("sites").select("id, name, code, active").order("active", { ascending: false }).order("name");
  const sites = (rawSites ?? []).filter((site) => profile.siteScopeIds === null || scopeContainsSite(profile.siteScopeIds, site.id)) as WasteSite[];
  const siteIds = sites.map((site) => site.id);
  if (!siteIds.length) return { sites, entries: [] };

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 70);
  const { data: rawEntries = [] } = await supabase
    .from("waste_log_entries")
    .select("id, site_id, business_date, item_name, category, reason, quantity, unit, estimated_cost, notes, logged_by, report_id, captured_at, created_at")
    .in("site_id", siteIds)
    .gte("business_date", since.toISOString().slice(0, 10))
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);
  const profileIds = [...new Set((rawEntries ?? []).map((entry) => entry.logged_by))];
  const { data: profiles = [] } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [] };
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));
  const profileNames = new Map((profiles ?? []).map((item) => [item.id, item.full_name]));
  const entries = (rawEntries ?? []).map((entry) => ({
    id: entry.id,
    siteId: entry.site_id,
    siteName: siteNames.get(entry.site_id) ?? "Kitchen",
    businessDate: entry.business_date,
    itemName: entry.item_name,
    category: entry.category,
    reason: entry.reason,
    quantity: entry.quantity == null ? null : Number(entry.quantity),
    unit: entry.unit,
    estimatedCost: Number(entry.estimated_cost),
    notes: entry.notes,
    loggedBy: profileNames.get(entry.logged_by) ?? "Manager",
    reportId: entry.report_id,
    capturedAt: entry.captured_at,
    createdAt: entry.created_at,
  }));
  return { sites, entries };
}

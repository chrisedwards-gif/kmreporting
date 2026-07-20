import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ManagerMessage = {
  id: string;
  siteId: string | null;
  siteName: string;
  recipientProfileId: string | null;
  recipientName: string;
  title: string;
  body: string;
  priority: "info" | "important" | "urgent";
  visibleFrom: string;
  visibleUntil: string | null;
  active: boolean;
};

export type TeamupCalendarLink = {
  id: string;
  siteId: string | null;
  siteName: string;
  title: string;
  calendarUrl: string;
  active: boolean;
};

export type ManagerHomeOption = { id: string; name: string };

export async function getVisibleManagerMessages(profile: SessionProfile): Promise<ManagerMessage[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("manager_messages")
    .select("id, site_id, recipient_profile_id, title, body, priority, visible_from, visible_until, active")
    .eq("active", true)
    .lte("visible_from", today)
    .or(`visible_until.is.null,visible_until.gte.${today}`)
    .order("priority", { ascending: false })
    .order("visible_from", { ascending: false });
  if (error || !data?.length) return [];

  const scoped = profile.isAccessPreview
    ? data.filter((row) => (
      (row.recipient_profile_id && row.recipient_profile_id === profile.previewManagerId)
      || (!row.recipient_profile_id && (!row.site_id || row.site_id === profile.previewSiteId))
    ))
    : data;
  const siteIds = [...new Set(scoped.flatMap((row) => row.site_id ? [row.site_id] : []))];
  const profileIds = [...new Set(scoped.flatMap((row) => row.recipient_profile_id ? [row.recipient_profile_id] : []))];
  const [{ data: sites }, { data: profiles }] = await Promise.all([
    siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
    profileIds.length ? supabase.from("profiles").select("id, full_name").in("id", profileIds) : Promise.resolve({ data: [] }),
  ]);
  const siteNames = new Map((sites ?? []).map((row) => [row.id, row.name]));
  const profileNames = new Map((profiles ?? []).map((row) => [row.id, row.full_name]));

  return scoped.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_id ? siteNames.get(row.site_id) ?? "Kitchen" : "All kitchens",
    recipientProfileId: row.recipient_profile_id,
    recipientName: row.recipient_profile_id ? profileNames.get(row.recipient_profile_id) ?? "Manager" : "All assigned managers",
    title: row.title,
    body: row.body,
    priority: row.priority as ManagerMessage["priority"],
    visibleFrom: row.visible_from,
    visibleUntil: row.visible_until,
    active: row.active,
  }));
}

export async function getManagerMessageAdminData(): Promise<{
  messages: ManagerMessage[];
  sites: ManagerHomeOption[];
  managers: ManagerHomeOption[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { messages: [], sites: [], managers: [] };
  const [{ data: rows }, { data: sites }, { data: managers }] = await Promise.all([
    supabase.from("manager_messages").select("id, site_id, recipient_profile_id, title, body, priority, visible_from, visible_until, active").order("visible_from", { ascending: false }).limit(200),
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "kitchen_manager").eq("active", true).order("full_name"),
  ]);
  const siteNames = new Map((sites ?? []).map((row) => [row.id, row.name]));
  const managerNames = new Map((managers ?? []).map((row) => [row.id, row.full_name]));
  return {
    messages: (rows ?? []).map((row) => ({
      id: row.id,
      siteId: row.site_id,
      siteName: row.site_id ? siteNames.get(row.site_id) ?? "Kitchen" : "All kitchens",
      recipientProfileId: row.recipient_profile_id,
      recipientName: row.recipient_profile_id ? managerNames.get(row.recipient_profile_id) ?? "Manager" : "All assigned managers",
      title: row.title,
      body: row.body,
      priority: row.priority as ManagerMessage["priority"],
      visibleFrom: row.visible_from,
      visibleUntil: row.visible_until,
      active: row.active,
    })),
    sites: (sites ?? []).map((row) => ({ id: row.id, name: row.name })),
    managers: (managers ?? []).map((row) => ({ id: row.id, name: row.full_name })),
  };
}

export async function getTeamupCalendarLinks(profile: SessionProfile): Promise<TeamupCalendarLink[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("teamup_calendar_links")
    .select("id, site_id, title, calendar_url, active")
    .eq("active", true)
    .order("site_id", { ascending: true, nullsFirst: true });
  if (error || !data?.length) return [];
  const scoped = profile.isAccessPreview
    ? data.filter((row) => !row.site_id || row.site_id === profile.previewSiteId)
    : data;
  const siteIds = [...new Set(scoped.flatMap((row) => row.site_id ? [row.site_id] : []))];
  const { data: sites } = siteIds.length
    ? await supabase.from("sites").select("id, name").in("id", siteIds)
    : { data: [] };
  const siteNames = new Map((sites ?? []).map((row) => [row.id, row.name]));
  return scoped.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_id ? siteNames.get(row.site_id) ?? "Kitchen" : "Group calendar",
    title: row.title,
    calendarUrl: row.calendar_url,
    active: row.active,
  }));
}

export async function getTeamupCalendarAdminData(): Promise<{
  links: TeamupCalendarLink[];
  sites: ManagerHomeOption[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { links: [], sites: [] };
  const [{ data: links }, { data: sites }] = await Promise.all([
    supabase.from("teamup_calendar_links").select("id, site_id, title, calendar_url, active").order("site_id", { ascending: true, nullsFirst: true }),
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
  ]);
  const siteNames = new Map((sites ?? []).map((row) => [row.id, row.name]));
  return {
    links: (links ?? []).map((row) => ({
      id: row.id,
      siteId: row.site_id,
      siteName: row.site_id ? siteNames.get(row.site_id) ?? "Kitchen" : "Group calendar",
      title: row.title,
      calendarUrl: row.calendar_url,
      active: row.active,
    })),
    sites: (sites ?? []).map((row) => ({ id: row.id, name: row.name })),
  };
}

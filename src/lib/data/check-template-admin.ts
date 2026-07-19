import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type CheckTemplateAdminSummary = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  description: string;
  cadence: "daily" | "weekly";
  passThreshold: number;
  watchThreshold: number;
  version: number;
  active: boolean;
  sectionCount: number;
  itemCount: number;
};

export type CheckTemplateAdminSection = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  items: Array<{
    id: string;
    subgroup: string;
    title: string;
    standard: string;
    critical: boolean;
    required: boolean;
    maxPoints: number;
    sortOrder: number;
  }>;
};

export async function getCheckTemplateAdminDirectory() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { templates: [] as CheckTemplateAdminSummary[], sites: [] as Array<{ id: string; name: string }> };
  const [{ data: templates }, { data: sites }] = await Promise.all([
    supabase.from("kitchen_check_templates").select("id, site_id, name, description, cadence, pass_threshold, watch_threshold, version, active").order("site_id").order("cadence"),
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
  ]);
  const templateIds = (templates ?? []).map((row) => row.id);
  const [{ data: sections }, { data: items }] = templateIds.length ? await Promise.all([
    supabase.from("kitchen_check_sections").select("id, template_id").in("template_id", templateIds),
    supabase.from("kitchen_check_items").select("id, template_id").in("template_id", templateIds),
  ]) : [{ data: [] }, { data: [] }];
  const siteNames = new Map((sites ?? []).map((row) => [row.id, row.name]));
  return {
    templates: (templates ?? []).map((row) => ({
      id: row.id,
      siteId: row.site_id,
      siteName: siteNames.get(row.site_id) ?? "Kitchen",
      name: row.name,
      description: row.description,
      cadence: row.cadence as "daily" | "weekly",
      passThreshold: Number(row.pass_threshold),
      watchThreshold: Number(row.watch_threshold),
      version: Number(row.version),
      active: row.active,
      sectionCount: (sections ?? []).filter((section) => section.template_id === row.id).length,
      itemCount: (items ?? []).filter((item) => item.template_id === row.id).length,
    })),
    sites: (sites ?? []).map((row) => ({ id: row.id, name: row.name })),
  };
}

export async function getCheckTemplateAdminDetail(templateId: string): Promise<(CheckTemplateAdminSummary & { sections: CheckTemplateAdminSection[] }) | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data: template, error } = await supabase.from("kitchen_check_templates").select("id, site_id, name, description, cadence, pass_threshold, watch_threshold, version, active").eq("id", templateId).maybeSingle();
  if (error || !template) return null;
  const [{ data: site }, { data: sections }, { data: items }] = await Promise.all([
    supabase.from("sites").select("id, name").eq("id", template.site_id).maybeSingle(),
    supabase.from("kitchen_check_sections").select("id, title, description, sort_order").eq("template_id", templateId).order("sort_order"),
    supabase.from("kitchen_check_items").select("id, section_id, subgroup, title, standard, critical, required, max_points, sort_order").eq("template_id", templateId).order("sort_order"),
  ]);
  const sectionRows: CheckTemplateAdminSection[] = (sections ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    sortOrder: section.sort_order,
    items: (items ?? []).filter((item) => item.section_id === section.id).map((item) => ({
      id: item.id,
      subgroup: item.subgroup ?? "",
      title: item.title,
      standard: item.standard,
      critical: item.critical,
      required: item.required,
      maxPoints: Number(item.max_points),
      sortOrder: item.sort_order,
    })),
  }));
  return {
    id: template.id,
    siteId: template.site_id,
    siteName: site?.name ?? "Kitchen",
    name: template.name,
    description: template.description,
    cadence: template.cadence as "daily" | "weekly",
    passThreshold: Number(template.pass_threshold),
    watchThreshold: Number(template.watch_threshold),
    version: Number(template.version),
    active: template.active,
    sectionCount: sectionRows.length,
    itemCount: sectionRows.reduce((sum, section) => sum + section.items.length, 0),
    sections: sectionRows,
  };
}

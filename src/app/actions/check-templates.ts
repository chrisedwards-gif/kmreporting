"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

const templateSchema = z.object({
  siteId: z.uuid(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000),
  cadence: z.enum(["daily", "weekly"]),
  passThreshold: z.coerce.number().min(1).max(100),
  watchThreshold: z.coerce.number().min(0).max(99),
});

export async function createCheckTemplate(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = templateSchema.parse(Object.fromEntries(formData));
  if (parsed.watchThreshold >= parsed.passThreshold) throw new Error("Watch threshold must be below the pass threshold.");
  const admin = createAdminClient();
  const { data: site } = await admin.from("sites").select("id").eq("id", parsed.siteId).eq("organisation_id", profile.organisationId).maybeSingle();
  if (!site) throw new Error("That kitchen is outside your organisation.");
  const { data, error } = await admin.from("kitchen_check_templates").insert({
    organisation_id: profile.organisationId,
    site_id: parsed.siteId,
    name: parsed.name,
    description: parsed.description,
    cadence: parsed.cadence,
    pass_threshold: parsed.passThreshold,
    watch_threshold: parsed.watchThreshold,
    version: 1,
    active: true,
    created_by: profile.id,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "The template could not be created.");
  await admin.from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "kitchen_check_template.created", entity_type: "kitchen_check_template", entity_id: data.id, detail: { site_id: parsed.siteId, cadence: parsed.cadence } });
  redirect(`/checks/templates/${data.id}`);
}

export async function cloneCheckTemplate(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const sourceTemplateId = z.uuid().parse(formData.get("sourceTemplateId"));
  const targetSiteId = z.uuid().parse(formData.get("targetSiteId"));
  const name = z.string().trim().min(2).max(160).parse(formData.get("name"));
  const admin = createAdminClient();
  const [{ data: source }, { data: site }] = await Promise.all([
    admin.from("kitchen_check_templates").select("id, organisation_id, description, cadence, require_actions, pass_threshold, watch_threshold").eq("id", sourceTemplateId).eq("organisation_id", profile.organisationId).maybeSingle(),
    admin.from("sites").select("id").eq("id", targetSiteId).eq("organisation_id", profile.organisationId).maybeSingle(),
  ]);
  if (!source || !site) throw new Error("The source template or destination kitchen could not be found.");
  const [{ data: sections }, { data: items }] = await Promise.all([
    admin.from("kitchen_check_sections").select("id, title, description, sort_order").eq("template_id", sourceTemplateId).order("sort_order"),
    admin.from("kitchen_check_items").select("section_id, subgroup, title, standard, critical, required, max_points, sort_order").eq("template_id", sourceTemplateId).order("sort_order"),
  ]);
  const { data: created, error } = await admin.from("kitchen_check_templates").insert({
    organisation_id: profile.organisationId,
    site_id: targetSiteId,
    name,
    description: source.description,
    cadence: source.cadence,
    require_actions: source.require_actions,
    pass_threshold: source.pass_threshold,
    watch_threshold: source.watch_threshold,
    version: 1,
    active: true,
    created_by: profile.id,
  }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "The template could not be cloned.");
  const sectionMap = new Map<string, string>();
  for (const section of sections ?? []) {
    const { data: inserted, error: sectionError } = await admin.from("kitchen_check_sections").insert({ template_id: created.id, title: section.title, description: section.description, sort_order: section.sort_order }).select("id").single();
    if (sectionError || !inserted) throw new Error(sectionError?.message ?? "A template section could not be cloned.");
    sectionMap.set(section.id, inserted.id);
  }
  if (items?.length) {
    const payload = items.flatMap((item) => {
      const sectionId = sectionMap.get(item.section_id);
      return sectionId ? [{ template_id: created.id, section_id: sectionId, subgroup: item.subgroup, title: item.title, standard: item.standard, critical: item.critical, required: item.required, max_points: item.max_points, sort_order: item.sort_order }] : [];
    });
    const { error: itemsError } = await admin.from("kitchen_check_items").insert(payload);
    if (itemsError) throw new Error(itemsError.message);
  }
  await admin.from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "kitchen_check_template.cloned", entity_type: "kitchen_check_template", entity_id: created.id, detail: { source_template_id: sourceTemplateId, target_site_id: targetSiteId } });
  redirect(`/checks/templates/${created.id}`);
}

export async function updateCheckTemplate(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const name = z.string().trim().min(2).max(160).parse(formData.get("name"));
  const description = z.string().trim().max(1000).parse(formData.get("description"));
  const passThreshold = z.coerce.number().min(1).max(100).parse(formData.get("passThreshold"));
  const watchThreshold = z.coerce.number().min(0).max(99).parse(formData.get("watchThreshold"));
  if (watchThreshold >= passThreshold) throw new Error("Watch threshold must be below the pass threshold.");
  const admin = createAdminClient();
  const { error } = await admin.from("kitchen_check_templates").update({ name, description, pass_threshold: passThreshold, watch_threshold: watchThreshold, updated_at: new Date().toISOString() }).eq("id", templateId).eq("organisation_id", profile.organisationId);
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

export async function setCheckTemplateActive(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const active = z.enum(["true", "false"]).parse(formData.get("active")) === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("kitchen_check_templates").update({ active, updated_at: new Date().toISOString() }).eq("id", templateId).eq("organisation_id", profile.organisationId);
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

export async function addCheckSection(formData: FormData) {
  await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const title = z.string().trim().min(2).max(160).parse(formData.get("title"));
  const description = z.string().trim().max(1000).parse(formData.get("description"));
  const admin = createAdminClient();
  const { data: latest } = await admin.from("kitchen_check_sections").select("sort_order").eq("template_id", templateId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from("kitchen_check_sections").insert({ template_id: templateId, title, description, sort_order: (latest?.sort_order ?? 0) + 1 });
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

export async function updateCheckSection(formData: FormData) {
  await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const sectionId = z.uuid().parse(formData.get("sectionId"));
  const title = z.string().trim().min(2).max(160).parse(formData.get("title"));
  const description = z.string().trim().max(1000).parse(formData.get("description"));
  const admin = createAdminClient();
  const { error } = await admin.from("kitchen_check_sections").update({ title, description }).eq("id", sectionId).eq("template_id", templateId);
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

export async function addCheckItem(formData: FormData) {
  await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const sectionId = z.uuid().parse(formData.get("sectionId"));
  const title = z.string().trim().min(2).max(240).parse(formData.get("title"));
  const standard = z.string().trim().max(2000).parse(formData.get("standard"));
  const subgroup = z.string().trim().max(160).parse(formData.get("subgroup"));
  const critical = formData.get("critical") === "on";
  const admin = createAdminClient();
  const { data: latest } = await admin.from("kitchen_check_items").select("sort_order").eq("template_id", templateId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from("kitchen_check_items").insert({ template_id: templateId, section_id: sectionId, subgroup: subgroup || null, title, standard, critical, required: true, max_points: 2, sort_order: (latest?.sort_order ?? 0) + 1 });
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

export async function updateCheckItem(formData: FormData) {
  await requireActualRole(["admin", "group_manager"]);
  const templateId = z.uuid().parse(formData.get("templateId"));
  const itemId = z.uuid().parse(formData.get("itemId"));
  const title = z.string().trim().min(2).max(240).parse(formData.get("title"));
  const standard = z.string().trim().max(2000).parse(formData.get("standard"));
  const subgroup = z.string().trim().max(160).parse(formData.get("subgroup"));
  const critical = formData.get("critical") === "on";
  const required = formData.get("required") === "on";
  const admin = createAdminClient();
  const { error } = await admin.from("kitchen_check_items").update({ title, standard, subgroup: subgroup || null, critical, required }).eq("id", itemId).eq("template_id", templateId);
  if (error) throw new Error(error.message);
  revalidateTemplate(templateId);
}

function revalidateTemplate(templateId: string) {
  revalidatePath("/checks");
  revalidatePath("/checks/templates");
  revalidatePath(`/checks/templates/${templateId}`);
}

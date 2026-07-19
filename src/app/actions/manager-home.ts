"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

const messageSchema = z.object({
  title: z.string().trim().min(2).max(140),
  body: z.string().trim().min(2).max(4000),
  priority: z.enum(["info", "important", "urgent"]),
  siteId: z.union([z.literal(""), z.uuid()]),
  recipientProfileId: z.union([z.literal(""), z.uuid()]),
  visibleFrom: z.iso.date(),
  visibleUntil: z.union([z.literal(""), z.iso.date()]),
});

const calendarSchema = z.object({
  title: z.string().trim().min(2).max(140),
  siteId: z.union([z.literal(""), z.uuid()]),
  calendarUrl: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "teamup.com" || url.hostname.endsWith(".teamup.com"));
    } catch {
      return false;
    }
  }, "Enter a secure Teamup calendar link."),
});

export async function createManagerMessage(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = messageSchema.parse(Object.fromEntries(formData));
  if (parsed.visibleUntil && parsed.visibleUntil < parsed.visibleFrom) {
    throw new Error("The end date cannot be before the start date.");
  }
  const recipientProfileId = parsed.recipientProfileId || null;
  const siteId = recipientProfileId ? null : parsed.siteId || null;
  const admin = createAdminClient();
  const { error } = await admin.from("manager_messages").insert({
    organisation_id: profile.organisationId,
    site_id: siteId,
    recipient_profile_id: recipientProfileId,
    title: parsed.title,
    body: parsed.body,
    priority: parsed.priority,
    visible_from: parsed.visibleFrom,
    visible_until: parsed.visibleUntil || null,
    active: true,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  await admin.from("audit_log").insert({
    organisation_id: profile.organisationId,
    actor_id: profile.id,
    action: "manager_message.created",
    entity_type: "manager_message",
    entity_id: null,
    detail: { site_id: siteId, recipient_profile_id: recipientProfileId, visible_from: parsed.visibleFrom },
  });
  revalidatePath("/dashboard");
  revalidatePath("/messages");
}

export async function setManagerMessageActive(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const id = z.uuid().parse(formData.get("id"));
  const active = z.enum(["true", "false"]).parse(formData.get("active")) === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("manager_messages").update({ active, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organisation_id", profile.organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  revalidatePath("/messages");
}

export async function saveTeamupCalendarLink(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = calendarSchema.parse(Object.fromEntries(formData));
  const admin = createAdminClient();
  const siteId = parsed.siteId || null;
  const { data: existing } = siteId
    ? await admin.from("teamup_calendar_links").select("id").eq("organisation_id", profile.organisationId).eq("site_id", siteId).maybeSingle()
    : await admin.from("teamup_calendar_links").select("id").eq("organisation_id", profile.organisationId).is("site_id", null).maybeSingle();
  const payload = {
    organisation_id: profile.organisationId,
    site_id: siteId,
    title: parsed.title,
    calendar_url: parsed.calendarUrl,
    active: true,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await admin.from("teamup_calendar_links").update(payload).eq("id", existing.id)
    : await admin.from("teamup_calendar_links").insert(payload);
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/calendar");
}

export async function setTeamupCalendarLinkActive(formData: FormData) {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const id = z.uuid().parse(formData.get("id"));
  const active = z.enum(["true", "false"]).parse(formData.get("active")) === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("teamup_calendar_links").update({ active, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organisation_id", profile.organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

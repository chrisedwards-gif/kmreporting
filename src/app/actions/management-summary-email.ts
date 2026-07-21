"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { deliverManagementPackEmail } from "@/lib/notifications/management-pack-email";
import { createAdminClient } from "@/lib/supabase/admin";

export type SummaryEmailState = { status: "idle" | "success" | "error"; message: string };

const periodSchema = z.object({ periodId: z.uuid() });

export async function sendManagementSummaryTestEmail(
  _previous: SummaryEmailState,
  formData: FormData,
): Promise<SummaryEmailState> {
  const actor = await requireActualRole(["admin", "group_manager"]);
  const parsed = periodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a valid reporting week." };

  try {
    const admin = createAdminClient();
    const { data: recipient, error } = await admin
      .from("profiles")
      .select("full_name, notification_email")
      .eq("id", actor.id)
      .single();
    if (error || !recipient?.notification_email) return { status: "error", message: "Add your notification email in People & access before sending a test." };
    const result = await deliverManagementPackEmail({
      organisationId: actor.organisationId,
      recipientName: recipient.full_name,
      recipientEmail: recipient.notification_email,
      periodId: parsed.data.periodId,
      allowPartial: true,
      deliveryKind: "test",
      actorId: actor.id,
    });
    revalidateDeliveryRoutes();
    return { status: result.ok ? "success" : "error", message: result.ok ? `Test pack with PDF attachment sent to ${recipient.notification_email}.` : result.message };
  } catch (error) {
    console.error("management summary email test failed", error);
    return { status: "error", message: "The management pack test could not be sent. Check the production email configuration." };
  }
}

const settingsSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  recipientEmail: z.email(),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  sendDay: z.coerce.number().int().min(0).max(6),
  sendHour: z.coerce.number().int().min(0).max(23),
  allowPartial: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function saveManagementEmailSettings(
  _previous: SummaryEmailState,
  formData: FormData,
): Promise<SummaryEmailState> {
  const actor = await requireActualRole(["admin", "group_manager"]);
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the weekly email settings." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("management_email_settings").upsert({
      organisation_id: actor.organisationId,
      recipient_name: parsed.data.recipientName,
      recipient_email: parsed.data.recipientEmail.toLowerCase(),
      enabled: parsed.data.enabled,
      send_day: parsed.data.sendDay,
      send_hour: parsed.data.sendHour,
      timezone: "Europe/London",
      allow_partial: parsed.data.allowPartial,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organisation_id" });
    if (error) return { status: "error", message: "The weekly email settings could not be saved." };
    await admin.from("audit_log").insert({
      organisation_id: actor.organisationId,
      actor_id: actor.id,
      action: "management_email.settings_updated",
      entity_type: "management_email_settings",
      entity_id: actor.organisationId,
      detail: { enabled: parsed.data.enabled, send_day: parsed.data.sendDay, send_hour: parsed.data.sendHour, allow_partial: parsed.data.allowPartial, recipient_email: parsed.data.recipientEmail.toLowerCase() },
    });
    revalidateDeliveryRoutes();
    return { status: "success", message: parsed.data.enabled ? "Weekly management email enabled and saved." : "Weekly management email settings saved; automatic delivery is paused." };
  } catch (error) {
    console.error("management email settings save failed", error);
    return { status: "error", message: "The weekly email settings could not be saved." };
  }
}

export async function sendManagementSummaryNow(
  _previous: SummaryEmailState,
  formData: FormData,
): Promise<SummaryEmailState> {
  const actor = await requireActualRole(["admin", "group_manager"]);
  const parsed = periodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a valid reporting week." };
  try {
    const admin = createAdminClient();
    const { data: settings, error } = await admin
      .from("management_email_settings")
      .select("recipient_name, recipient_email, allow_partial")
      .eq("organisation_id", actor.organisationId)
      .single();
    if (error || !settings?.recipient_email) return { status: "error", message: "Save Jake’s recipient email before sending the live pack." };
    const result = await deliverManagementPackEmail({
      organisationId: actor.organisationId,
      recipientName: settings.recipient_name,
      recipientEmail: settings.recipient_email,
      periodId: parsed.data.periodId,
      allowPartial: Boolean(settings.allow_partial),
      deliveryKind: "manual",
      actorId: actor.id,
    });
    revalidateDeliveryRoutes();
    return { status: result.ok ? "success" : "error", message: result.message };
  } catch (error) {
    console.error("live management email failed", error);
    return { status: "error", message: "The live management pack could not be sent." };
  }
}

function revalidateDeliveryRoutes() {
  for (const path of ["/summary", "/notifications", "/admin", "/dashboard"]) revalidatePath(path);
}

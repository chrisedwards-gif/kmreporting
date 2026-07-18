"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { reminderContent, type ReminderKind } from "@/lib/notifications/reminders";
import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationTestState = { status: "idle" | "success" | "error"; message: string };

const schema = z.object({ kind: z.enum(["report_initial", "report_final", "approval_review"]) });

export async function sendTestNotification(
  _previous: NotificationTestState,
  formData: FormData,
): Promise<NotificationTestState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a reminder type." };
  const profile = await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) return { status: "success", message: "Demo reminder test validated; no email was sent." };

  try {
    const admin = createAdminClient();
    const { data: recipient } = await admin.from("profiles").select("id, full_name, notification_email").eq("id", profile.id).single();
    if (!recipient?.notification_email) return { status: "error", message: "Add a notification email to your profile before testing delivery." };
    const kind = parsed.data.kind as ReminderKind;
    const content = reminderContent(kind);
    const { data: logged, error: logError } = await admin.from("notification_log").insert({
      organisation_id: profile.organisationId,
      recipient_id: profile.id,
      notification_type: `test_${kind}`,
      dedupe_key: `test:${profile.id}:${kind}:${crypto.randomUUID()}`,
      delivery_status: "queued",
    }).select("id").single();
    if (logError || !logged) return { status: "error", message: "The test reminder could not be queued." };

    if (!environment.reminderWebhookUrl) {
      revalidatePath("/notifications");
      return { status: "success", message: `Test queued for ${recipient.notification_email}. Configure REMINDER_WEBHOOK_URL before expecting an email.` };
    }

    const response = await fetch(environment.reminderWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true, kind, recipient, subject: content.subject, message: content.message, actionPath: content.actionPath }),
    });
    await admin.from("notification_log").update({
      delivery_status: response.ok ? "sent" : "failed",
      sent_at: response.ok ? new Date().toISOString() : null,
    }).eq("id", logged.id);
    revalidatePath("/notifications");
    return response.ok
      ? { status: "success", message: `Test delivered to the configured webhook for ${recipient.notification_email}.` }
      : { status: "error", message: `The webhook returned HTTP ${response.status}. The failed attempt is recorded.` };
  } catch {
    return { status: "error", message: "Notification testing requires the server-side Supabase key in Vercel." };
  }
}

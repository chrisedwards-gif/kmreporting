"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { deliverReminderWebhook } from "@/lib/notifications/delivery";
import { sendTransactionalEmail } from "@/lib/notifications/email";
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
    const { data: recipient, error: recipientError } = await admin
      .from("profiles")
      .select("id, full_name, notification_email")
      .eq("id", profile.id)
      .single();
    if (recipientError || !recipient?.notification_email) {
      return { status: "error", message: "Add a notification email to your profile before testing delivery." };
    }

    const kind = parsed.data.kind as ReminderKind;
    const content = reminderContent(kind);
    const intendedEmail = recipient.notification_email;
    const actualDeliveryEmail = environment.reminderRecipientOverride ?? intendedEmail;
    const { data: logged, error: logError } = await admin.from("notification_log").insert({
      organisation_id: profile.organisationId,
      recipient_id: profile.id,
      notification_type: `test_${kind}`,
      dedupe_key: `test:${profile.id}:${kind}:${crypto.randomUUID()}`,
      delivery_status: "queued",
      recipient_email: intendedEmail,
      subject: content.subject,
      message: content.message,
      action_path: content.actionPath,
    }).select("id").single();
    if (logError || !logged) return { status: "error", message: "The test reminder could not be queued." };

    const resend = await sendTransactionalEmail({
      to: intendedEmail,
      subject: content.subject,
      text: content.message,
      idempotencyKey: `notification-test-${logged.id}`,
    });
    if (resend.configured) {
      await admin.from("notification_log").update({
        delivery_status: resend.ok ? "sent" : "failed",
        provider_reference: resend.providerReference || null,
        error_message: resend.ok ? null : resend.error,
        sent_at: resend.ok ? new Date().toISOString() : null,
      }).eq("id", logged.id);
      revalidatePath("/notifications");
      return resend.ok
        ? { status: "success", message: `Resend accepted the test for ${actualDeliveryEmail}${environment.reminderRecipientOverride ? " via the UAT recipient override" : ""}.` }
        : { status: "error", message: `Resend delivery failed: ${resend.error}` };
    }

    if (!environment.reminderWebhookUrl) {
      revalidatePath("/notifications");
      return { status: "success", message: `Test queued for ${intendedEmail}. Configure RESEND_API_KEY and RESEND_FROM_EMAIL to send it; REMINDER_WEBHOOK_URL is only an optional fallback.` };
    }

    const deliveryRecipient = { ...recipient, notification_email: actualDeliveryEmail };
    const delivery = await deliverReminderWebhook(environment.reminderWebhookUrl, {
      test: true,
      kind,
      recipient: deliveryRecipient,
      intendedRecipientEmail: intendedEmail,
      recipientOverridden: Boolean(environment.reminderRecipientOverride),
      subject: content.subject,
      message: content.message,
      actionPath: content.actionPath,
    });

    const { error: updateError } = await admin.from("notification_log").update({
      delivery_status: delivery.ok ? "sent" : "failed",
      provider_reference: delivery.providerReference || null,
      error_message: delivery.ok ? null : delivery.error,
      sent_at: delivery.ok ? new Date().toISOString() : null,
    }).eq("id", logged.id);

    revalidatePath("/notifications");
    if (updateError) return { status: "error", message: "The webhook responded, but its delivery status could not be saved." };
    return delivery.ok
      ? { status: "success", message: `The delivery webhook accepted the test for ${actualDeliveryEmail}${environment.reminderRecipientOverride ? " via the UAT recipient override" : ""}.` }
      : { status: "error", message: `${delivery.error} The failed attempt is recorded.` };
  } catch (error) {
    console.error("notification test failed", error);
    return { status: "error", message: "The notification test could not be completed. Check the Vercel server configuration and try again." };
  }
}

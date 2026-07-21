import { NextRequest, NextResponse } from "next/server";
import { environment } from "@/lib/env";
import { deliverManagementPackEmail } from "@/lib/notifications/management-pack-email";
import { createAdminClient } from "@/lib/supabase/admin";

const weekdayIndex: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!environment.cronSecret || token !== environment.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: settings, error } = await admin
    .from("management_email_settings")
    .select("organisation_id, recipient_name, recipient_email, enabled, send_day, send_hour, timezone, allow_partial")
    .eq("enabled", true)
    .not("recipient_email", "is", null);
  if (error) return NextResponse.json({ error: "Settings unavailable" }, { status: 500 });

  const now = new Date();
  const results: Array<{ organisationId: string; status: string; message: string }> = [];
  for (const setting of settings ?? []) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: setting.timezone || "Europe/London",
      weekday: "long",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
    const dueToday = weekdayIndex[weekday] === Number(setting.send_day) && hour >= Number(setting.send_hour);
    if (!dueToday) {
      results.push({ organisationId: setting.organisation_id, status: "not_due", message: "Outside the configured local delivery window." });
      continue;
    }

    const delivery = await deliverManagementPackEmail({
      organisationId: setting.organisation_id,
      recipientName: setting.recipient_name,
      recipientEmail: setting.recipient_email,
      allowPartial: Boolean(setting.allow_partial),
      deliveryKind: "scheduled",
    });
    results.push({
      organisationId: setting.organisation_id,
      status: delivery.ok ? delivery.skipped ? "already_sent" : "sent" : delivery.skipped ? "waiting" : "failed",
      message: delivery.message,
    });
  }

  return NextResponse.json({ checkedAt: now.toISOString(), results });
}

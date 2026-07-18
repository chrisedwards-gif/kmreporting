import { NextResponse, type NextRequest } from "next/server";
import { environment } from "@/lib/env";
import { deliverReminderWebhook } from "@/lib/notifications/delivery";
import { reminderContent, type ReminderKind } from "@/lib/notifications/reminders";
import { isSiteExpectedForReportingWeek } from "@/lib/reporting/periods";
import { hasValidBearerSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

const getLondonParts = (date: Date) => Object.fromEntries(
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]),
);

const toDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDate(date);
};

const londonNoon = (value: string) => {
  const probe = new Date(`${value}T12:00:00Z`);
  const zoneName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneName.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offset = sign * (Number(match?.[2] ?? 0) * 60 + Number(match?.[3] ?? 0));
  return new Date(probe.valueOf() - offset * 60_000).toISOString();
};

const getPreviousWeek = (now: Date) => {
  const daysSinceSaturday = ((now.getUTCDay() + 1) % 7) || 7;
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() - daysSinceSaturday);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  return { start: toDate(start), end: toDate(end) };
};

type ReminderRecipient = {
  id: string;
  full_name: string;
  notification_email: string;
};

type ReminderSite = {
  id: string;
  name: string;
};

type QueuedReminder = {
  organisation_id: string;
  recipient_id: string;
  report_id: string | null;
  site_id: string | null;
  notification_type: ReminderKind;
  dedupe_key: string;
  delivery_status: "queued";
  recipient: ReminderRecipient;
  site?: ReminderSite;
};

export async function GET(request: NextRequest) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), environment.cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const london = getLondonParts(now);
  const hour = Number(london.hour);
  const kind: ReminderKind | null = london.weekday === "Mon" && hour === 9
    ? "report_initial"
    : london.weekday === "Mon" && hour === 12
      ? "report_final"
      : london.weekday === "Tue" && hour === 10
        ? "approval_review"
        : null;

  if (!kind) return NextResponse.json({ ok: true, skipped: "Outside reminder windows" });

  const supabase = createAdminClient();
  const week = getPreviousWeek(now);
  const { data: organisations, error: organisationError } = await supabase
    .from("organisations")
    .select("id, timezone");
  if (organisationError) return NextResponse.json({ error: organisationError.message }, { status: 500 });

  const queued: QueuedReminder[] = [];
  let skippedNoEmail = 0;

  for (const organisation of organisations ?? []) {
    const dueAt = londonNoon(addDays(week.end, 2));
    const { data: period, error: periodError } = await supabase
      .from("reporting_periods")
      .upsert({ organisation_id: organisation.id, week_start: week.start, week_end: week.end, due_at: dueAt, reporting_cycle: "sunday_saturday" }, { onConflict: "organisation_id,week_start" })
      .select("id")
      .single();
    if (periodError || !period) continue;

    const [siteResult, reportResult] = await Promise.all([
      supabase
        .from("sites")
        .select("id, name, active, reporting_start_date, reporting_end_date")
        .eq("organisation_id", organisation.id)
        .eq("active", true),
      supabase
        .from("weekly_reports")
        .select("id, site_id, status")
        .eq("organisation_id", organisation.id)
        .eq("period_id", period.id),
    ]);
    if (siteResult.error || reportResult.error) continue;

    const sites = siteResult.data ?? [];
    const reports = reportResult.data ?? [];
    const siteById = new Map(sites.map((site) => [site.id, site]));
    const reportBySite = new Map(reports.map((report) => [report.site_id, report]));

    if (kind === "approval_review") {
      const reviewReports = reports.filter((report) => ["submitted", "review_required"].includes(report.status));
      const { data: reviewers } = await supabase
        .from("profiles")
        .select("id, full_name, notification_email")
        .eq("organisation_id", organisation.id)
        .eq("active", true)
        .in("role", ["admin", "group_manager"]);

      for (const report of reviewReports) {
        const site = siteById.get(report.site_id);
        for (const reviewer of reviewers ?? []) {
          if (!reviewer.notification_email) {
            skippedNoEmail += 1;
            continue;
          }
          queued.push({
            organisation_id: organisation.id,
            recipient_id: reviewer.id,
            report_id: report.id,
            site_id: report.site_id,
            notification_type: kind,
            dedupe_key: `${period.id}:${report.site_id}:${reviewer.id}:${kind}`,
            delivery_status: "queued",
            recipient: { ...reviewer, notification_email: reviewer.notification_email },
            site: site ? { id: site.id, name: site.name } : undefined,
          });
        }
      }
    } else {
      const expectedSites = sites.filter((site) => isSiteExpectedForReportingWeek({
        active: site.active,
        reportingStartDate: site.reporting_start_date,
        reportingEndDate: site.reporting_end_date,
      }, week));
      const outstanding = expectedSites.filter((site) => {
        const report = reportBySite.get(site.id);
        return !report || report.status === "draft";
      });

      for (const site of outstanding) {
        const { data: memberships, error: membershipError } = await supabase
          .from("site_memberships")
          .select("user_id")
          .eq("site_id", site.id)
          .eq("can_submit", true);
        if (membershipError || !memberships?.length) continue;

        const userIds = memberships.map((membership) => membership.user_id);
        const { data: recipients, error: recipientError } = await supabase
          .from("profiles")
          .select("id, full_name, notification_email")
          .in("id", userIds)
          .eq("active", true);
        if (recipientError) continue;

        for (const recipient of recipients ?? []) {
          if (!recipient.notification_email) {
            skippedNoEmail += 1;
            continue;
          }
          queued.push({
            organisation_id: organisation.id,
            recipient_id: recipient.id,
            report_id: reportBySite.get(site.id)?.id ?? null,
            site_id: site.id,
            notification_type: kind,
            dedupe_key: `${period.id}:${site.id}:${recipient.id}:${kind}`,
            delivery_status: "queued",
            site: { id: site.id, name: site.name },
            recipient: { ...recipient, notification_email: recipient.notification_email },
          });
        }
      }
    }
  }

  let created = 0;
  let delivered = 0;
  let failed = 0;

  for (const item of queued) {
    const { recipient, site, ...row } = item;
    const { data: inserted, error } = await supabase
      .from("notification_log")
      .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error || !inserted) continue;
    created += 1;

    if (!environment.reminderWebhookUrl) continue;

    const content = reminderContent(kind, site?.name, week.end);
    const delivery = await deliverReminderWebhook(environment.reminderWebhookUrl, {
      kind,
      recipient,
      site,
      reportId: row.report_id,
      week,
      subject: content.subject,
      message: content.message,
      actionPath: content.actionPath,
    });

    const providerReference = delivery.providerReference || (delivery.status ? `HTTP ${delivery.status}` : null);
    await supabase.from("notification_log").update({
      delivery_status: delivery.ok ? "sent" : "failed",
      provider_reference: providerReference,
      sent_at: delivery.ok ? new Date().toISOString() : null,
    }).eq("id", inserted.id);

    if (delivery.ok) delivered += 1;
    else failed += 1;
  }

  return NextResponse.json({ ok: true, kind, week, queued: created, delivered, failed, skippedNoEmail });
}

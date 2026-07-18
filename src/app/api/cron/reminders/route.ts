import { NextResponse, type NextRequest } from "next/server";
import { environment } from "@/lib/env";
import { isSiteExpectedForReportingWeek } from "@/lib/reporting/periods";
import { hasValidBearerSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { reminderContent, type ReminderKind } from "@/lib/notifications/reminders";

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

  const queued: Array<Record<string, unknown>> = [];
  for (const organisation of organisations ?? []) {
    const dueAt = londonNoon(addDays(week.end, 2));
    const { data: period, error: periodError } = await supabase
      .from("reporting_periods")
      .upsert({ organisation_id: organisation.id, week_start: week.start, week_end: week.end, due_at: dueAt, reporting_cycle: "sunday_saturday" }, { onConflict: "organisation_id,week_start" })
      .select("id")
      .single();
    if (periodError || !period) continue;

    const { data: sites } = await supabase
      .from("sites")
      .select("id, name, active, reporting_start_date, reporting_end_date")
      .eq("organisation_id", organisation.id)
      .eq("active", true);
    const { data: reports } = await supabase
      .from("weekly_reports")
      .select("id, site_id, status")
      .eq("organisation_id", organisation.id)
      .eq("period_id", period.id);
    const reportBySite = new Map((reports ?? []).map((report) => [report.site_id, report]));

    if (kind === "approval_review") {
      const reviewReports = (reports ?? []).filter((report) => ["submitted", "review_required"].includes(report.status));
      const { data: reviewers } = await supabase
        .from("profiles")
        .select("id, full_name, notification_email")
        .eq("organisation_id", organisation.id)
        .eq("active", true)
        .in("role", ["admin", "group_manager"]);
      for (const report of reviewReports) {
        for (const recipient of reviewers ?? []) {
          queued.push({
            organisation_id: organisation.id,
            recipient_id: recipient.id,
            report_id: report.id,
            site_id: report.site_id,
            notification_type: kind,
            dedupe_key: `${period.id}:${report.site_id}:${recipient.id}:${kind}`,
            delivery_status: "queued",
            recipient,
          });
        }
      }
    } else {
      const expectedSites = (sites ?? []).filter((site) => isSiteExpectedForReportingWeek({
        active: site.active,
        reportingStartDate: site.reporting_start_date,
        reportingEndDate: site.reporting_end_date,
      }, week));
      const outstanding = expectedSites.filter((site) => {
        const report = reportBySite.get(site.id);
        return !report || report.status === "draft";
      });
      for (const site of outstanding) {
        const { data: memberships } = await supabase
          .from("site_memberships")
          .select("user_id, profiles!inner(id, full_name, notification_email, active)")
          .eq("site_id", site.id)
          .eq("can_submit", true);
        for (const membership of memberships ?? []) {
          const recipient = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles;
          if (!recipient?.active) continue;
          queued.push({
            organisation_id: organisation.id,
            recipient_id: membership.user_id,
            report_id: reportBySite.get(site.id)?.id ?? null,
            site_id: site.id,
            notification_type: kind,
            dedupe_key: `${period.id}:${site.id}:${membership.user_id}:${kind}`,
            delivery_status: "queued",
            site,
            recipient,
          });
        }
      }
    }
  }

  let created = 0;
  for (const item of queued) {
    const { recipient, site, ...row } = item;
    const { data: inserted, error } = await supabase
      .from("notification_log")
      .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error || !inserted) continue;
    created += 1;

    if (environment.reminderWebhookUrl) {
      const content = reminderContent(kind, typeof site === "object" && site && "name" in site ? String(site.name) : undefined, week.end);
      const response = await fetch(environment.reminderWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, recipient, site, reportId: row.report_id, week, subject: content.subject, message: content.message, actionPath: content.actionPath }),
      });
      await supabase.from("notification_log").update({
        delivery_status: response.ok ? "sent" : "failed",
        sent_at: response.ok ? new Date().toISOString() : null,
      }).eq("id", inserted.id);
    }
  }

  return NextResponse.json({ ok: true, kind, week, queued: created });
}

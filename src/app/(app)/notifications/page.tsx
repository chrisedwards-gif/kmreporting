import Link from "next/link";
import { BellRing, CheckCircle2, CircleDashed, ExternalLink, MailCheck, TriangleAlert } from "lucide-react";
import { ManagementEmailSettings } from "@/components/notifications/management-email-settings";
import { TestNotificationForm } from "@/components/notifications/test-notification-form";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getReportingPeriods } from "@/lib/data/reporting";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Notifications" };

type NotificationRow = {
  id: string;
  notification_type: string;
  delivery_status: string;
  created_at: string;
  sent_at: string | null;
  provider_reference: string | null;
  recipient_id: string | null;
  recipient_email: string | null;
  site_id: string | null;
  one_to_one_review_id: string | null;
  subject: string | null;
  action_path: string | null;
  error_message: string | null;
};

export default async function NotificationsPage() {
  await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const supabase = await createServerSupabaseClient();
  let notifications: NotificationRow[] = [];
  let loadError = "";
  let emailSettings = { recipientName: "Jake Atkinson", recipientEmail: "", enabled: false, sendDay: 3, sendHour: 10, allowPartial: true, lastSentAt: null as string | null };
  const periods = await getReportingPeriods();
  const profilesById = new Map<string, { full_name: string; notification_email: string | null }>();
  const sitesById = new Map<string, string>();

  if (supabase) {
    const [{ data, error }, { data: settings }] = await Promise.all([
      supabase
        .from("notification_log")
        .select("id, notification_type, delivery_status, created_at, sent_at, provider_reference, recipient_id, recipient_email, site_id, one_to_one_review_id, subject, action_path, error_message")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("management_email_settings")
        .select("recipient_name, recipient_email, enabled, send_day, send_hour, allow_partial, last_sent_at")
        .maybeSingle(),
    ]);

    if (settings) emailSettings = {
      recipientName: settings.recipient_name,
      recipientEmail: settings.recipient_email ?? "",
      enabled: Boolean(settings.enabled),
      sendDay: Number(settings.send_day),
      sendHour: Number(settings.send_hour),
      allowPartial: Boolean(settings.allow_partial),
      lastSentAt: settings.last_sent_at,
    };

    if (error) {
      console.error("notification history load failed", { code: error.code, message: error.message });
      loadError = "Notification history could not be loaded. Test delivery is still available.";
    } else {
      notifications = (data ?? []) as NotificationRow[];
      const recipientIds = [...new Set(notifications.map((item) => item.recipient_id).filter((value): value is string => Boolean(value)))];
      const siteIds = [...new Set(notifications.map((item) => item.site_id).filter((value): value is string => Boolean(value)))];
      const [{ data: profiles }, { data: sites }] = await Promise.all([
        recipientIds.length ? supabase.from("profiles").select("id, full_name, notification_email").in("id", recipientIds) : Promise.resolve({ data: [] }),
        siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
      ]);
      for (const profile of profiles ?? []) profilesById.set(profile.id, { full_name: profile.full_name, notification_email: profile.notification_email });
      for (const site of sites ?? []) sitesById.set(site.id, site.name);
    }
  }

  const counts = notifications.reduce((result, item) => ({ ...result, [item.delivery_status]: (result[item.delivery_status] ?? 0) + 1 }), {} as Record<string, number>);
  const deliveryState = !environment.resendApiKey || !environment.resendFromEmail
    ? <><TriangleAlert aria-hidden="true" size={15} /> Resend is not fully configured, so email delivery is unavailable.</>
    : environment.reminderRecipientOverride
      ? <><CheckCircle2 aria-hidden="true" size={15} /> UAT sandbox active: every delivery is redirected to {environment.reminderRecipientOverride}.</>
      : <><CheckCircle2 aria-hidden="true" size={15} /> Resend delivery is configured for live recipients.</>;

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Delivery control</p><h1 className="page-header__title">Email & notifications.</h1><p className="page-header__copy">Schedule Jake’s weekly pack, send a full PDF test and monitor reminders, approval prompts and finalised 1-1 summaries.</p></div></header>
      {loadError ? <div className="form-message form-message--error" role="alert">{loadError}</div> : null}

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Jake’s weekly management email</h2><p className="panel__subtitle">Automatic written readout plus the native A4 PDF attachment</p></div><MailCheck aria-hidden="true" size={19} /></div>
        <div className="panel__body"><div className="privacy-callout notification-delivery-state">{deliveryState}</div><ManagementEmailSettings settings={emailSettings} periods={periods.map((period) => ({ id: period.id, label: `Week ending ${formatDate(period.week_end)}` }))} /></div>
      </section>

      <div className="dashboard-grid">
        <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Basic delivery test</h2><p className="panel__subtitle">A simple message to validate the sender and recipient path</p></div><BellRing aria-hidden="true" size={19} /></div><div className="panel__body"><TestNotificationForm /></div></section>
        <aside className="panel"><div className="panel__header"><div><h2 className="panel__title">Recent status</h2><p className="panel__subtitle">Last 50 notification records</p></div></div><div className="panel__body"><div className="cost-summary"><div className="cost-summary__row"><span className="cost-summary__label">Sent</span><span className="cost-summary__value">{counts.sent ?? 0}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Queued</span><span className="cost-summary__value">{counts.queued ?? 0}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Failed</span><span className="cost-summary__value">{counts.failed ?? 0}</span></div></div></div></aside>
      </div>
      <section className="panel notifications-history"><div className="panel__header"><div><h2 className="panel__title">Delivery history</h2><p className="panel__subtitle">Management packs, reminders, tests and manager 1-1 summaries</p></div></div><div className="panel__body"><div className="report-list">
        {notifications.map((item) => {
          const profile = item.recipient_id ? profilesById.get(item.recipient_id) : undefined;
          const siteName = item.site_id ? sitesById.get(item.site_id) : undefined;
          return <div className="report-row" key={item.id}><div className="site-cell"><div className="site-cell__mark"><BellRing size={16} /></div><div><div className="site-cell__name">{item.subject ?? item.notification_type.replaceAll("_", " ")}</div><div className="site-cell__manager">{profile?.full_name ?? "Recipient"} · {item.recipient_email ?? profile?.notification_email ?? "No email"}{item.error_message ? <span className="notification-error"> · {item.error_message}</span> : null}</div></div></div><div><span className="report-row__metric-label">Kitchen</span>{siteName ?? "General"}</div><div><span className="report-row__metric-label">Created</span>{formatDate(item.created_at)}</div><div><span className="report-row__metric-label">Sent</span>{item.sent_at ? formatDate(item.sent_at) : "—"}{item.provider_reference ? <span className="basis-label">{item.provider_reference}</span> : null}</div><span className={`status-badge status-badge--${item.delivery_status === "sent" ? "approved" : item.delivery_status === "failed" ? "review_required" : "draft"}`}>{item.delivery_status === "queued" ? <CircleDashed aria-hidden="true" size={13} /> : null}{item.delivery_status}</span>{item.action_path ? <Link aria-label="Open linked record" href={item.action_path}><ExternalLink aria-hidden="true" size={16} /></Link> : null}</div>;
        })}
        {!notifications.length ? <div className="empty-inline empty-inline--compact">No notification records yet.</div> : null}
      </div></div></section>
    </>
  );
}

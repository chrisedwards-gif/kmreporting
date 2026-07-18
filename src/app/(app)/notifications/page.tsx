import { BellRing, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { TestNotificationForm } from "@/components/notifications/test-notification-form";
import { requireRole } from "@/lib/auth/dal";
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
  recipient_id: string;
  site_id: string | null;
};

export default async function NotificationsPage() {
  await requireRole(["admin", "group_manager"]);
  const supabase = await createServerSupabaseClient();

  let notifications: NotificationRow[] = [];
  let loadError = "";
  const profilesById = new Map<string, { full_name: string; notification_email: string | null }>();
  const sitesById = new Map<string, string>();

  if (supabase) {
    const { data, error } = await supabase
      .from("notification_log")
      .select("id, notification_type, delivery_status, created_at, sent_at, provider_reference, recipient_id, site_id")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("notification history load failed", { code: error.code, message: error.message });
      loadError = "Notification history could not be loaded. Test delivery is still available.";
    } else {
      notifications = (data ?? []) as NotificationRow[];
      const recipientIds = [...new Set(notifications.map((item) => item.recipient_id))];
      const siteIds = [...new Set(notifications.map((item) => item.site_id).filter((value): value is string => Boolean(value)))];

      const [{ data: profiles }, { data: sites }] = await Promise.all([
        recipientIds.length
          ? supabase.from("profiles").select("id, full_name, notification_email").in("id", recipientIds)
          : Promise.resolve({ data: [] }),
        siteIds.length
          ? supabase.from("sites").select("id, name").in("id", siteIds)
          : Promise.resolve({ data: [] }),
      ]);

      for (const profile of profiles ?? []) {
        profilesById.set(profile.id, {
          full_name: profile.full_name,
          notification_email: profile.notification_email,
        });
      }
      for (const site of sites ?? []) sitesById.set(site.id, site.name);
    }
  }

  const counts = notifications.reduce(
    (result, item) => ({ ...result, [item.delivery_status]: (result[item.delivery_status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  const deliveryState = !environment.reminderWebhookUrl
    ? <><TriangleAlert aria-hidden="true" size={15} /> Queue-only mode: no delivery webhook is configured yet.</>
    : environment.reminderRecipientOverride
      ? <><CheckCircle2 aria-hidden="true" size={15} /> UAT sandbox active: every delivery is redirected to {environment.reminderRecipientOverride}.</>
      : environment.isPreview
        ? <><TriangleAlert aria-hidden="true" size={15} /> Preview webhook is live without a recipient override. Scheduled reminders would use profile email addresses.</>
        : <><CheckCircle2 aria-hidden="true" size={15} /> Delivery webhook configured.</>;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Delivery control</p>
          <h1 className="page-header__title">Reminders & notifications.</h1>
          <p className="page-header__copy">Test delivery safely, then monitor Monday report reminders and Tuesday approval prompts.</p>
        </div>
      </header>

      {loadError ? <div className="form-message form-message--error" role="alert">{loadError}</div> : null}

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel__header">
            <div><h2 className="panel__title">Test delivery</h2><p className="panel__subtitle">Tests go only to your profile email or the configured UAT override</p></div>
            <BellRing aria-hidden="true" size={19} />
          </div>
          <div className="panel__body">
            <div className="privacy-callout" style={{ marginBottom: "1rem" }}>{deliveryState}</div>
            <TestNotificationForm />
          </div>
        </section>

        <aside className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Recent status</h2><p className="panel__subtitle">Last 50 notification records</p></div></div>
          <div className="panel__body">
            <div className="cost-summary">
              <div className="cost-summary__row"><span className="cost-summary__label">Sent</span><span className="cost-summary__value">{counts.sent ?? 0}</span></div>
              <div className="cost-summary__row"><span className="cost-summary__label">Queued</span><span className="cost-summary__value">{counts.queued ?? 0}</span></div>
              <div className="cost-summary__row"><span className="cost-summary__label">Failed</span><span className="cost-summary__value">{counts.failed ?? 0}</span></div>
            </div>
          </div>
        </aside>
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel__header"><div><h2 className="panel__title">Delivery history</h2><p className="panel__subtitle">Deduplicated reminders and test attempts</p></div></div>
        <div className="panel__body">
          <div className="report-list">
            {notifications.map((item) => {
              const profile = profilesById.get(item.recipient_id);
              const siteName = item.site_id ? sitesById.get(item.site_id) : undefined;
              return (
                <div className="report-row" key={item.id}>
                  <div className="site-cell">
                    <div className="site-cell__mark"><BellRing size={16} /></div>
                    <div>
                      <div className="site-cell__name">{item.notification_type.replaceAll("_", " ")}</div>
                      <div className="site-cell__manager">{profile?.full_name ?? "Recipient"} · {profile?.notification_email ?? "No email"}</div>
                    </div>
                  </div>
                  <div><span className="report-row__metric-label">Kitchen</span>{siteName ?? "General test"}</div>
                  <div><span className="report-row__metric-label">Created</span>{formatDate(item.created_at)}</div>
                  <div><span className="report-row__metric-label">Sent</span>{item.sent_at ? formatDate(item.sent_at) : "—"}{item.provider_reference ? <span className="basis-label">{item.provider_reference}</span> : null}</div>
                  <span className={`status-badge status-badge--${item.delivery_status === "sent" ? "approved" : item.delivery_status === "failed" ? "review_required" : "draft"}`}>
                    {item.delivery_status === "queued" ? <CircleDashed aria-hidden="true" size={13} /> : null}
                    {item.delivery_status}
                  </span>
                </div>
              );
            })}
            {!notifications.length ? <div className="empty-inline empty-inline--compact">No reminder or test records yet.</div> : null}
          </div>
        </div>
      </section>
    </>
  );
}

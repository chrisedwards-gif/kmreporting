import { BellRing, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { TestNotificationForm } from "@/components/notifications/test-notification-form";
import { requireRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireRole(["admin", "group_manager"]);
  const supabase = await createServerSupabaseClient();
  const { data: notifications = [] } = supabase ? await supabase.from("notification_log").select("id, notification_type, delivery_status, created_at, sent_at, sites(name), profiles!notification_log_recipient_id_fkey(full_name, notification_email)").order("created_at", { ascending: false }).limit(50) : { data: [] };
  const counts = (notifications ?? []).reduce((result, item) => ({ ...result, [item.delivery_status]: (result[item.delivery_status] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Delivery control</p><h1 className="page-header__title">Reminders & notifications.</h1><p className="page-header__copy">Test delivery safely, then monitor Monday report reminders and Tuesday approval prompts.</p></div></header>
      <div className="dashboard-grid">
        <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Test delivery</h2><p className="panel__subtitle">Tests go only to your profile notification email</p></div><BellRing aria-hidden="true" size={19} /></div><div className="panel__body"><div className="privacy-callout" style={{ marginBottom: "1rem" }}>{environment.reminderWebhookUrl ? <><CheckCircle2 aria-hidden="true" size={15} /> Delivery webhook configured.</> : <><TriangleAlert aria-hidden="true" size={15} /> Queue-only mode: no delivery webhook is configured yet.</>}</div><TestNotificationForm /></div></section>
        <aside className="panel"><div className="panel__header"><div><h2 className="panel__title">Recent status</h2><p className="panel__subtitle">Last 50 notification records</p></div></div><div className="panel__body"><div className="cost-summary"><div className="cost-summary__row"><span className="cost-summary__label">Sent</span><span className="cost-summary__value">{counts.sent ?? 0}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Queued</span><span className="cost-summary__value">{counts.queued ?? 0}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Failed</span><span className="cost-summary__value">{counts.failed ?? 0}</span></div></div></div></aside>
      </div>
      <section className="panel" style={{ marginTop: "1rem" }}><div className="panel__header"><div><h2 className="panel__title">Delivery history</h2><p className="panel__subtitle">Deduplicated reminders and test attempts</p></div></div><div className="panel__body"><div className="report-list">{(notifications ?? []).map((item) => { const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles; const site = Array.isArray(item.sites) ? item.sites[0] : item.sites; return <div className="report-row" key={item.id}><div className="site-cell"><div className="site-cell__mark"><BellRing size={16} /></div><div><div className="site-cell__name">{item.notification_type.replaceAll("_", " ")}</div><div className="site-cell__manager">{profile?.full_name ?? "Recipient"} · {profile?.notification_email ?? "No email"}</div></div></div><div><span className="report-row__metric-label">Kitchen</span>{site?.name ?? "General test"}</div><div><span className="report-row__metric-label">Created</span>{formatDate(item.created_at)}</div><div><span className="report-row__metric-label">Sent</span>{item.sent_at ? formatDate(item.sent_at) : "—"}</div><span className={`status-badge status-badge--${item.delivery_status === "sent" ? "approved" : item.delivery_status === "failed" ? "review_required" : "draft"}`}>{item.delivery_status === "queued" ? <CircleDashed aria-hidden="true" size={13} /> : null}{item.delivery_status}</span></div>; })}{!notifications?.length ? <div className="empty-inline empty-inline--compact">No reminder or test records yet.</div> : null}</div></div></section>
    </>
  );
}

import { BellRing, CalendarClock, MessageSquareText } from "lucide-react";
import { createManagerMessage, setManagerMessageActive } from "@/app/actions/manager-home";
import { requireActualRole } from "@/lib/auth/dal";
import { getManagerMessageAdminData } from "@/lib/data/manager-home";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Team messages" };

export default async function TeamMessagesPage() {
  await requireActualRole(["admin", "group_manager"]);
  const { messages, sites, managers } = await getManagerMessageAdminData();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="page-header">
        <div><p className="page-header__eyebrow">Manager communication</p><h1 className="page-header__title">Team messages.</h1><p className="page-header__copy">Leave a note for every manager, one kitchen or one person. Schedule it for a future date or keep it visible across a date range.</p></div>
      </header>

      <div className="dashboard-grid dashboard-grid--balanced">
        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Create message</h2><p className="panel__subtitle">Appears at the top of the manager home dashboard</p></div><MessageSquareText aria-hidden="true" size={19} /></div>
          <form action={createManagerMessage} className="panel__body report-form">
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field__label">Title</span><input className="field__input" name="title" placeholder="Today’s focus" required /></label>
              <label className="field"><span className="field__label">Priority</span><select className="field__input" defaultValue="info" name="priority"><option value="info">Information</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label>
            </div>
            <label className="field"><span className="field__label">Message</span><textarea className="field__input" name="body" placeholder="Service focus, delivery note, reminder or encouragement…" required rows={5} /></label>
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field__label">Kitchen audience</span><select className="field__input" defaultValue="" name="siteId"><option value="">All kitchens</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><span className="field__hint">Leave as All kitchens for a group message.</span></label>
              <label className="field"><span className="field__label">Specific manager</span><select className="field__input" defaultValue="" name="recipientProfileId"><option value="">Everyone in the selected audience</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select><span className="field__hint">Choosing a person overrides the kitchen audience.</span></label>
            </div>
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field__label">Show from</span><input className="field__input" defaultValue={today} name="visibleFrom" type="date" required /></label>
              <label className="field"><span className="field__label">Hide after</span><input className="field__input" name="visibleUntil" type="date" /><span className="field__hint">Leave blank to keep it visible until switched off.</span></label>
            </div>
            <button className="button button--primary" type="submit"><CalendarClock aria-hidden="true" size={16} /> Schedule message</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Message schedule</h2><p className="panel__subtitle">Current, future and switched-off notices</p></div><BellRing aria-hidden="true" size={19} /></div>
          <div className="panel__body stack">
            {messages.map((message) => (
              <article className={`manager-message manager-message--${message.priority}${message.active ? "" : " manager-message--inactive"}`} key={message.id}>
                <div className="manager-message__head"><div><strong>{message.title}</strong><span>{message.recipientProfileId ? message.recipientName : message.siteName}</span></div><span className={`status-badge status-badge--${message.active ? "approved" : "draft"}`}>{message.active ? "Active" : "Off"}</span></div>
                <p>{message.body}</p>
                <small>{formatDate(message.visibleFrom)}{message.visibleUntil ? ` – ${formatDate(message.visibleUntil)}` : " onward"}</small>
                <form action={setManagerMessageActive}><input name="id" type="hidden" value={message.id} /><input name="active" type="hidden" value={message.active ? "false" : "true"} /><button className="button button--secondary button--compact" type="submit">{message.active ? "Switch off" : "Reactivate"}</button></form>
              </article>
            ))}
            {!messages.length ? <div className="empty-inline">No management messages have been scheduled yet.</div> : null}
          </div>
        </section>
      </div>
    </>
  );
}

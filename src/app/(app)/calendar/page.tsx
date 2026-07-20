import { CalendarDays, ExternalLink, Link2 } from "lucide-react";
import { saveTeamupCalendarLink, setTeamupCalendarLinkActive } from "@/app/actions/manager-home";
import { requireRole } from "@/lib/auth/dal";
import { getTeamupCalendarAdminData, getTeamupCalendarLinks } from "@/lib/data/manager-home";

export const metadata = { title: "Kitchen calendar" };

export default async function CalendarPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const canConfigure = ["admin", "group_manager"].includes(profile.actualRole) && !profile.isAccessPreview;
  const [visibleLinks, adminData] = await Promise.all([
    getTeamupCalendarLinks(profile),
    canConfigure ? getTeamupCalendarAdminData() : Promise.resolve({ links: [], sites: [] }),
  ]);
  const preferred = visibleLinks.find((link) => link.siteId === profile.previewSiteId)
    ?? visibleLinks.find((link) => link.siteId)
    ?? visibleLinks[0];

  return (
    <>
      <header className="page-header">
        <div><p className="page-header__eyebrow">Planning</p><h1 className="page-header__title">Kitchen calendar.</h1><p className="page-header__copy">Teamup events stay in Teamup while the shared calendar is available alongside reports, checks and daily actions.</p></div>
        {preferred ? <a className="button button--secondary" href={preferred.calendarUrl} rel="noreferrer" target="_blank">Open in Teamup <ExternalLink aria-hidden="true" size={15} /></a> : null}
      </header>

      {preferred ? (
        <section className="panel calendar-panel">
          <div className="panel__header"><div><h2 className="panel__title">{preferred.title}</h2><p className="panel__subtitle">{preferred.siteName}</p></div><CalendarDays aria-hidden="true" size={19} /></div>
          <iframe className="teamup-frame" loading="lazy" referrerPolicy="no-referrer" src={preferred.calendarUrl} title={preferred.title} />
        </section>
      ) : (
        <section className="panel empty-state"><CalendarDays aria-hidden="true" size={25} /><h2>No Teamup calendar connected.</h2><p>Group management can add a secure Teamup share link below. The permissions on that link remain controlled in Teamup.</p></section>
      )}

      {visibleLinks.length > 1 ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Available calendars</h2><p className="panel__subtitle">Group-wide and kitchen-specific links you can access</p></div></div><div className="panel__body action-list">{visibleLinks.map((link) => <a className="action-list__row" href={link.calendarUrl} key={link.id} rel="noreferrer" target="_blank"><div><strong>{link.title}</strong><span>{link.siteName}</span></div><ExternalLink aria-hidden="true" size={15} /></a>)}</div></section> : null}

      {canConfigure ? (
        <section className="panel">
          <div className="panel__header"><div><h2 className="panel__title">Calendar access</h2><p className="panel__subtitle">Use one read-only or editable Teamup share link per kitchen, plus an optional group calendar</p></div><Link2 aria-hidden="true" size={19} /></div>
          <div className="panel__body dashboard-grid dashboard-grid--balanced">
            <form action={saveTeamupCalendarLink} className="report-form">
              <label className="field"><span className="field__label">Display title</span><input className="field__input" name="title" placeholder="House of Social operations" required /></label>
              <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue="" name="siteId"><option value="">Group-wide calendar</option>{adminData.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
              <label className="field"><span className="field__label">Teamup share link</span><input className="field__input" name="calendarUrl" placeholder="https://teamup.com/ks…" required type="url" /><span className="field__hint">Create the link in Teamup with only the sub-calendars and permissions this audience should receive.</span></label>
              <button className="button button--primary" type="submit">Save calendar link</button>
            </form>
            <div className="stack">
              {adminData.links.map((link) => <article className="manager-message" key={link.id}><div className="manager-message__head"><div><strong>{link.title}</strong><span>{link.siteName}</span></div><span className={`status-badge status-badge--${link.active ? "approved" : "draft"}`}>{link.active ? "Active" : "Off"}</span></div><form action={setTeamupCalendarLinkActive}><input name="id" type="hidden" value={link.id} /><input name="active" type="hidden" value={link.active ? "false" : "true"} /><button className="button button--secondary button--compact" type="submit">{link.active ? "Switch off" : "Reactivate"}</button></form></article>)}
              {!adminData.links.length ? <div className="empty-inline">No calendar links configured.</div> : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, DatabaseZap, MessageSquareText, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { RotaControls } from "@/components/rotas/rota-controls";
import { RotaPlanView } from "@/components/rotas/rota-plan-view";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";
import { addDays } from "@/lib/rota/forecasting";
import { buildRotaPlan } from "@/lib/rota/planner";
import { environment } from "@/lib/env";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Rota intelligence" };

type Params = { site?: string; week?: string };

export default async function RotasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [profile, params] = await Promise.all([requireSessionProfile(), searchParams]);
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) return <AccessDenied />;
  const workspace = await getRotaPlanningWorkspace({ profile, requestedSiteId: params.site, requestedWeekStart: params.week });
  const site = workspace.selectedSite;
  const demoPlan = environment.isDemo && site && workspace.staff.length ? buildRotaPlan({
    weekStart: workspace.weekStart, labourTargetPct: site.labourTarget, history: workspace.history, events: workspace.events,
    dayRules: workspace.dayRules, demand: workspace.demand, staff: workspace.staff, forecastWeeks: workspace.forecastWeeks,
    minimumHistoryWeeks: workspace.minimumHistoryWeeks, minimumRestHours: workspace.minimumRestHours, intervalMinutes: workspace.intervalMinutes, salesPerLabourHourTarget: workspace.salesPerLabourHourTarget,
  }) : null;
  const plan = workspace.latestPlan ?? (demoPlan ? { ...demoPlan, id: "demo-plan", version: 1, status: "suggested" } : null);
  const priorWeek = addDays(workspace.weekStart, -7);
  const nextWeek = addDays(workspace.weekStart, 7);
  const siteQuery = site ? `&site=${encodeURIComponent(site.id)}` : "";
  const historyWeeks = Math.floor(workspace.history.length / 7);
  const hasHourlyShape = workspace.demand.some((point) => point.source === "hourly_sales");
  const canManageTeam = profile.actualRole === "admin" || profile.actualRole === "group_manager";

  return (
    <>
      <header className="page-header">
        <div><p className="page-header__eyebrow">Forecast · cover · people</p><h1 className="page-header__title">Rota intelligence.</h1><p className="page-header__copy">Turn dated sales, labour targets and private staff constraints into a one-click rota suggestion—with every assumption visible.</p></div>
        <div className="page-header__actions">
          {site ? <Link className="button button--secondary" href={`/rotas/feedback?site=${site.id}`}><MessageSquareText aria-hidden="true" size={16} /> Shift feedback</Link> : null}
          {canManageTeam ? <><Link className="button button--secondary" href={site ? `/rotas/settings?site=${site.id}` : "/rotas/settings"}><Settings2 aria-hidden="true" size={16} /> Calibrate site</Link><Link className="button button--secondary" href="/rotas/team"><UsersRound aria-hidden="true" size={16} /> Staff profiles</Link></> : null}
        </div>
      </header>

      <form className="rota-filters panel" method="get">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={site?.id} name="site">{workspace.sites.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.labourTarget.toFixed(1)}% labour</option>)}</select></label>
        <label className="field"><span className="field__label">Week commencing</span><input className="field__input" defaultValue={workspace.weekStart} name="week" type="date" /></label>
        <button className="button button--secondary" type="submit"><CalendarClock aria-hidden="true" size={16} /> Load week</button>
        <div className="rota-filters__weeks"><Link aria-label="Previous week" className="icon-button" href={`/rotas?week=${priorWeek}${siteQuery}`}><ArrowLeft aria-hidden="true" size={16} /></Link><span>{formatDate(workspace.weekStart)}–{formatDate(addDays(workspace.weekStart, 6))}</span><Link aria-label="Next week" className="icon-button" href={`/rotas?week=${nextWeek}${siteQuery}`}><ArrowRight aria-hidden="true" size={16} /></Link></div>
      </form>

      {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}
      {site ? (
        <>
          <section aria-label="Rota readiness" className="rota-readiness">
            <Readiness icon={DatabaseZap} label="Sales history" ready={historyWeeks >= workspace.minimumHistoryWeeks} value={`${historyWeeks} full week${historyWeeks === 1 ? "" : "s"}`} detail={`Minimum ${workspace.minimumHistoryWeeks}; ${workspace.forecastWeeks} matching weekdays used`} />
            <Readiness icon={UsersRound} label="Staff constraints" ready={workspace.staff.length >= 2} value={`${workspace.staff.length} active profile${workspace.staff.length === 1 ? "" : "s"}`} detail="Wages remain private; availability and skills drive assignment" />
            <Readiness icon={Settings2} label="Day-part demand" ready={hasHourlyShape} value={hasHourlyShape ? "Actual hourly sales" : "Editable template"} detail={hasHourlyShape ? "Peak curve learned from EPOS" : "Clearly labelled until hourly EPOS data arrives"} />
            <Readiness icon={ShieldCheck} label="RotaCloud" ready={workspace.rotacloudConfigured} value={workspace.rotacloudConfigured ? "Read-only sync enabled" : "Manual handoff"} detail="No shifts are published automatically in this release" />
          </section>
          <RotaControls siteId={site.id} weekStart={workspace.weekStart} />
          {workspace.events.length ? <section className="rota-events panel"><strong>Forecast adjustments this week</strong>{workspace.events.map((event) => <span key={`${event.eventDate}-${event.title}`}>{formatDate(event.eventDate)} · {event.title} · {event.salesUpliftPct >= 0 ? "+" : ""}{event.salesUpliftPct}%</span>)}</section> : null}
          {plan ? <RotaPlanView plan={plan} /> : <section className="panel empty-state"><CalendarClock aria-hidden="true" size={28} /><h2>No suggestion generated for this week.</h2><p>Complete the readiness gaps above, add known events, then generate. A new run creates a new audited version and supersedes the previous suggestion.</p></section>}
        </>
      ) : null}
    </>
  );
}

function Readiness({ icon: Icon, label, ready, value, detail }: { icon: typeof DatabaseZap; label: string; ready: boolean; value: string; detail: string }) {
  return <article className={`rota-readiness__item ${ready ? "rota-readiness__item--ready" : "rota-readiness__item--attention"}`}><Icon aria-hidden="true" size={19} /><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function AccessDenied() { return <section className="panel empty-state"><h1>Rota intelligence is not available for this role.</h1><p>Ask an administrator if you need operational rota access.</p></section>; }

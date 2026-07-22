import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, CircleAlert, MessageSquareText, Settings2, UsersRound } from "lucide-react";
import { RotaControls } from "@/components/rotas/rota-controls";
import { RotaCopilot } from "@/components/rotas/rota-copilot";
import { RotaPlanView } from "@/components/rotas/rota-plan-view";
import "@/components/rotas/rota-workspace.module.css";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";
import { environment } from "@/lib/env";
import { getExternalRotaSignals } from "@/lib/rota/external-signals";
import { addDays } from "@/lib/rota/forecasting";
import { buildRotaPlan } from "@/lib/rota/planner";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Plan a rota" };
type Params = { site?: string; week?: string };

export default async function RotasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [profile, params] = await Promise.all([requireSessionProfile(), searchParams]);
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) return <AccessDenied />;

  const workspace = await getRotaPlanningWorkspace({ profile, requestedSiteId: params.site, requestedWeekStart: params.week });
  const site = workspace.selectedSite;
  const signals = await getExternalRotaSignals(workspace.weekStart);
  const demoPlan = environment.isDemo && site && workspace.staff.length ? buildRotaPlan({
    weekStart: workspace.weekStart,
    labourTargetPct: site.labourTarget,
    history: workspace.history,
    events: workspace.events,
    dayRules: workspace.dayRules,
    demand: workspace.demand,
    staff: workspace.staff,
    forecastWeeks: workspace.forecastWeeks,
    minimumHistoryWeeks: workspace.minimumHistoryWeeks,
    minimumRestHours: workspace.minimumRestHours,
    intervalMinutes: workspace.intervalMinutes,
    salesPerLabourHourTarget: workspace.salesPerLabourHourTarget,
  }) : null;
  const plan = workspace.latestPlan ?? (demoPlan ? { ...demoPlan, id: "demo-plan", version: 1, status: "suggested" } : null);
  const staffTargets = workspace.staff.map((staff) => ({
    id: staff.id,
    name: staff.staffName,
    minimumHours: staff.minimumWeeklyHours,
    targetHours: staff.targetWeeklyHours,
    maximumHours: staff.maximumWeeklyHours,
  }));
  const priorWeek = addDays(workspace.weekStart, -7);
  const nextWeek = addDays(workspace.weekStart, 7);
  const siteQuery = site ? `&site=${encodeURIComponent(site.id)}` : "";
  const historyWeeks = Math.floor(workspace.history.length / 7);
  const hasEnoughHistory = historyWeeks >= workspace.minimumHistoryWeeks;
  const hasHourlyShape = workspace.demand.some((point) => point.source === "hourly_sales");
  const readiness = [
    { label: "Sales history", value: `${historyWeeks} complete week${historyWeeks === 1 ? "" : "s"}`, detail: `At least ${workspace.minimumHistoryWeeks} needed`, ready: hasEnoughHistory },
    { label: "Team", value: `${workspace.staff.length} active profile${workspace.staff.length === 1 ? "" : "s"}`, detail: "Availability, skills and agreed hours", ready: workspace.staff.length >= 2 },
    { label: "Busy periods", value: hasHourlyShape ? "Learned from hourly sales" : "Using the site template", detail: "Visible on the rota heatmap", ready: true },
    { label: "RotaCloud handoff", value: workspace.rotacloudConfigured ? "Read-only connection" : "CSV export", detail: "Nothing is published automatically", ready: true },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;
  const canManageTeam = profile.actualRole === "admin" || profile.actualRole === "group_manager";

  return <>
    <header className="rota-page-header">
      <div><p className="page-header__eyebrow">People and labour</p><h1>Plan next week’s rota</h1><p>See when the kitchen will be busy, move the shifts into place and fix anything highlighted before you export.</p></div>
      <nav aria-label="Rota tools" className="rota-page-header__links">
        {site ? <Link className="button button--secondary" href={`/rotas/feedback?site=${site.id}`}><MessageSquareText aria-hidden="true" size={16} /> Shift feedback</Link> : null}
        {canManageTeam ? <><Link className="button button--secondary" href="/rotas/team"><UsersRound aria-hidden="true" size={16} /> Team</Link><Link className="button button--secondary" href={site ? `/rotas/settings?site=${site.id}` : "/rotas/settings"}><Settings2 aria-hidden="true" size={16} /> Planner settings</Link></> : null}
      </nav>
    </header>

    <form className="rota-toolbar panel" method="get">
      <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={site?.id} name="site">{workspace.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field"><span className="field__label">Week starting</span><input className="field__input" defaultValue={workspace.weekStart} name="week" type="date" /></label>
      <button className="button button--secondary" type="submit"><CalendarClock aria-hidden="true" size={16} /> Open week</button>
      <div className="rota-toolbar__week"><Link aria-label="Previous week" className="icon-button" href={`/rotas?week=${priorWeek}${siteQuery}`}><ArrowLeft aria-hidden="true" size={16} /></Link><span>{formatDate(workspace.weekStart)}–{formatDate(addDays(workspace.weekStart, 6))}</span><Link aria-label="Next week" className="icon-button" href={`/rotas?week=${nextWeek}${siteQuery}`}><ArrowRight aria-hidden="true" size={16} /></Link></div>
    </form>

    {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}
    {site ? <>
      <details className={`rota-setup panel ${readyCount < readiness.length ? "rota-setup--attention" : ""}`}>
        <summary>{readyCount === readiness.length ? <CheckCircle2 aria-hidden="true" size={19} /> : <CircleAlert aria-hidden="true" size={19} />}<span><strong>{readyCount === readiness.length ? "Everything needed to plan is ready" : `${readyCount} of ${readiness.length} planning inputs are ready`}</strong><small>Open this only when you need to check where the suggestion comes from.</small></span></summary>
        <div className="rota-setup__details">{readiness.map((item) => <div className="rota-setup__item" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>)}</div>
      </details>
      <RotaControls hasPlan={Boolean(plan)} siteId={site.id} weekStart={workspace.weekStart} />
      {plan ? <><RotaPlanView aiReview={null} plan={plan} signals={signals} staffTargets={staffTargets} /><RotaCopilot initialReview={null} plan={plan} signals={signals} staffTargets={staffTargets} /></> : <section className="panel empty-state"><CalendarClock aria-hidden="true" size={30} /><h2>No rota has been built for this week yet</h2><p>Use “Build this week’s rota” above. You will get an editable starting point, not a published rota.</p></section>}
    </> : null}
  </>;
}

function AccessDenied() { return <section className="panel empty-state"><h1>Rota planning is not available for this role.</h1></section>; }

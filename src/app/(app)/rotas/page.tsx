import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  MessageSquareText,
  Settings2,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { RotaAiBrief } from "@/components/rotas/rota-ai-brief";
import { RotaControls } from "@/components/rotas/rota-controls";
import { RotaWeekFeedbackStrip } from "@/components/rotas/rota-week-feedback";
import { RotaWeekOverlay } from "@/components/rotas/rota-week-overlay";
import "@/components/rotas/rota-workspace.module.css";
import { requireSessionProfile } from "@/lib/auth/dal";
import {
  applyRotaBuilderNotes,
  getRotaBuilderMetadata,
  type RotaBuilderMetadata,
} from "@/lib/data/rota-builder";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";
import { getRotaWeekFeedback } from "@/lib/data/rota-week-feedback";
import { environment } from "@/lib/env";
import { getExternalRotaSignals } from "@/lib/rota/external-signals";
import { addDays } from "@/lib/rota/forecasting";
import { buildRotaPlan } from "@/lib/rota/planner";
import {
  visibleRotaPlan,
  visibleRotaStaff,
  type RotaFinanceVisibility,
} from "@/lib/rota/visibility";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Rota builder" };
type Params = { site?: string; week?: string };

const emptyBuilderMetadata: RotaBuilderMetadata = { marks: [], notes: [] };

export default async function RotasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const [profile, params] = await Promise.all([
    requireSessionProfile(),
    searchParams,
  ]);
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) {
    return <AccessDenied />;
  }

  const workspace = await getRotaPlanningWorkspace({
    profile,
    requestedSiteId: params.site,
    requestedWeekStart: params.week,
  });
  const site = workspace.selectedSite;
  const signals = await getExternalRotaSignals(workspace.weekStart);
  const demoPlan = environment.isDemo && site && workspace.staff.length
    ? buildRotaPlan({
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
      })
    : null;
  const rawPlan = workspace.latestPlan
    ?? (demoPlan
      ? { ...demoPlan, id: "demo-plan", version: 1, status: "suggested" }
      : null);

  const financeVisibility: RotaFinanceVisibility =
    profile.actualRole === "kitchen_manager" ? "hourly_only" : "full";
  const builderMetadata = rawPlan && site && rawPlan.id !== "demo-plan"
    ? await getRotaBuilderMetadata({
        planId: rawPlan.id,
        organisationId: profile.organisationId,
        siteId: site.id,
      })
    : emptyBuilderMetadata;
  const plan = rawPlan
    ? applyRotaBuilderNotes(
        visibleRotaPlan(rawPlan, financeVisibility),
        builderMetadata,
      )
    : null;
  const weekFeedback = plan && site && plan.id !== "demo-plan"
    ? await getRotaWeekFeedback({
        organisationId: profile.organisationId,
        siteId: site.id,
        profileId: profile.id,
        weekStart: plan.weekStart,
        weekEnd: plan.weekEnd,
      })
    : [];
  const visibleStaff = visibleRotaStaff(workspace.staff);
  const staffTargets = visibleStaff.map((staff) => ({
    id: staff.id,
    name: staff.name,
    minimumHours: staff.organisationWide ? 0 : staff.minimumHours,
    targetHours: staff.organisationWide ? 0 : staff.targetHours,
    maximumHours: staff.organisationWide ? 100 : staff.maximumHours,
  }));

  const priorWeek = addDays(workspace.weekStart, -7);
  const nextWeek = addDays(workspace.weekStart, 7);
  const siteQuery = site ? `&site=${encodeURIComponent(site.id)}` : "";
  const historyWeeks = Math.floor(workspace.history.length / 7);
  const hasEnoughHistory = historyWeeks >= workspace.minimumHistoryWeeks;
  const hasHourlyShape = workspace.demand.some(
    (point) => point.source === "hourly_sales",
  );
  const linkedCount = workspace.staff.filter((staff) => staff.appProfileId).length;
  const readiness = [
    {
      label: "Sales history",
      value: `${historyWeeks} complete week${historyWeeks === 1 ? "" : "s"}`,
      detail: `At least ${workspace.minimumHistoryWeeks} needed`,
      ready: hasEnoughHistory,
    },
    {
      label: "Team identities",
      value: `${linkedCount} of ${workspace.staff.length} linked`,
      detail: "Login UUIDs, roles, skills and agreed hours",
      ready: workspace.staff.length >= 2 && linkedCount > 0,
    },
    {
      label: "Busy periods",
      value: hasHourlyShape ? "Learned from hourly sales" : "Using the site template",
      detail: "Shown as a heat strip above each day",
      ready: true,
    },
    {
      label: "RotaCloud handoff",
      value: workspace.rotacloudConfigured ? "Read-only connection" : "Copy or CSV",
      detail: "Build here, then publish the approved rota in RotaCloud",
      ready: true,
    },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;
  const canManageTeam = profile.actualRole === "admin" || profile.actualRole === "group_manager";

  return (
    <>
      <header className="rota-page-header rota-page-header--compact">
        <div>
          <p className="page-header__eyebrow">People and labour</p>
          <h1>Build the week with demand, cost and cover beside every shift.</h1>
          <p>The grid is the workspace. Supporting setup, AI challenge and optional templates sit below it.</p>
        </div>
        <nav aria-label="Rota tools" className="rota-page-header__links">
          {site ? <Link className="button button--secondary" href={`/rotas/feedback?site=${site.id}`}><MessageSquareText aria-hidden="true" size={16} /> Feedback history</Link> : null}
          {canManageTeam ? <><Link className="button button--secondary" href="/rotas/team"><UsersRound aria-hidden="true" size={16} /> Team & order</Link><Link className="button button--secondary" href={site ? `/rotas/settings?site=${site.id}` : "/rotas/settings"}><Settings2 aria-hidden="true" size={16} /> Forecast settings</Link></> : null}
        </nav>
      </header>

      <form className="rota-toolbar panel rota-toolbar--sticky" method="get">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={site?.id} name="site">{workspace.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Week starting</span><input className="field__input" defaultValue={workspace.weekStart} name="week" type="date" /></label>
        <button className="button button--secondary" type="submit"><CalendarClock aria-hidden="true" size={16} /> Open week</button>
        <div className="rota-toolbar__week"><Link aria-label="Previous week" className="icon-button" href={`/rotas?week=${priorWeek}${siteQuery}`}><ArrowLeft aria-hidden="true" size={16} /></Link><span>{formatDate(workspace.weekStart)}–{formatDate(addDays(workspace.weekStart, 6))}</span><Link aria-label="Next week" className="icon-button" href={`/rotas?week=${nextWeek}${siteQuery}`}><ArrowRight aria-hidden="true" size={16} /></Link></div>
      </form>

      {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}

      {site ? (
        <>
          {plan ? (
            <>
              <RotaWeekOverlay
                financeVisibility={financeVisibility}
                key={`${plan.id}-${plan.plannedHours}-${plan.plannedCost}-${visibleStaff.length}`}
                marks={builderMetadata.marks}
                plan={plan}
                signals={signals}
                siteId={site.id}
                staff={visibleStaff}
              />
              <RotaWeekFeedbackStrip days={plan.days.map((day) => day.businessDate)} feedback={weekFeedback} siteId={site.id} />
              <RotaAiBrief plan={plan} signals={signals} staffTargets={staffTargets} />
            </>
          ) : (
            <section className="panel empty-state rota-empty-first">
              <CalendarClock aria-hidden="true" size={30} />
              <h2>No rota draft exists for this week yet</h2>
              <p>Start a blank forecast-led week. The grid will open immediately with the full ranked team, sales forecast and demand heat maps.</p>
              <RotaControls hasPlan={false} siteId={site.id} weekStart={workspace.weekStart} />
            </section>
          )}

          {plan ? (
            <section className="rota-supporting-tools" aria-labelledby="rota-support-title">
              <header><SlidersHorizontal aria-hidden="true" size={19} /><div><p className="page-header__eyebrow">Below the working rota</p><h2 id="rota-support-title">Setup, events and optional starting tools</h2><p>These controls support the grid but do not interrupt normal weekly rota building.</p></div></header>
              <RotaControls hasPlan siteId={site.id} weekStart={workspace.weekStart} />
              <details className={`rota-setup panel ${readyCount < readiness.length ? "rota-setup--attention" : ""}`}>
                <summary>{readyCount === readiness.length ? <CheckCircle2 aria-hidden="true" size={19} /> : <CircleAlert aria-hidden="true" size={19} />}<span><strong>{readyCount === readiness.length ? "Planning inputs are ready" : `${readyCount} of ${readiness.length} planning inputs are ready`}</strong><small>Open this only to check where the guidance comes from.</small></span></summary>
                <div className="rota-setup__details">{readiness.map((item) => <div className="rota-setup__item" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>)}</div>
              </details>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function AccessDenied() {
  return <section className="panel empty-state"><h1>Rota planning is not available for this role.</h1></section>;
}

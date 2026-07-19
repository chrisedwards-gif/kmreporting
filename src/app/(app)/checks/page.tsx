import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck2, CheckCircle2, ClipboardCheck, Clock3, ShieldAlert } from "lucide-react";
import { startKitchenCheck } from "@/app/actions/kitchen-checks";
import { requireRole } from "@/lib/auth/dal";
import { getKitchenCheckDashboard } from "@/lib/data/kitchen-checks";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Kitchen checks" };

const londonDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const resultLabel = {
  in_progress: "In progress",
  pass: "Pass",
  watch: "Watch",
  fail: "Fail",
} as const;

export default async function KitchenChecksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (profile.isAccessPreview) redirect("/dashboard");
  const [{ templates, runs }, { error }] = await Promise.all([getKitchenCheckDashboard(), searchParams]);
  const currentWeek = getCurrentReportingWeek();
  const today = londonDate();

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Standards & compliance</p><h1 className="page-header__title">Kitchen checks.</h1><p className="page-header__copy">Daily close-down and weekly audit templates are unique to each kitchen. Amber and Red findings cannot disappear: they create owned actions with deadlines.</p></div></header>
      {error ? <div className="form-message form-message--error" role="alert">{error}</div> : null}
      <section className="check-template-grid">
        {templates.map((template) => {
          const periodStart = template.cadence === "weekly" ? currentWeek.start : today;
          const currentRun = runs.find((run) => run.templateId === template.id && run.periodStart === periodStart);
          const latest = runs.find((run) => run.templateId === template.id);
          return <article className="panel check-template-card" key={template.id}><div className="panel__header"><div><p className="page-header__eyebrow">{template.siteName} · {template.cadence}</p><h2 className="panel__title">{template.name}</h2><p className="panel__subtitle">{template.description}</p></div><span className="code-pill">v{template.version}</span></div><div className="panel__body"><div className="check-template-card__meta"><span><ClipboardCheck aria-hidden="true" size={15} /> {template.itemCount} checks</span><span><CheckCircle2 aria-hidden="true" size={15} /> Pass at {template.passThreshold}%</span><span><ShieldAlert aria-hidden="true" size={15} /> Critical Red = fail</span></div>{latest ? <div className={`check-latest check-latest--${latest.result}`}><span>Latest</span><strong>{latest.percentage === null ? resultLabel[latest.result] : `${latest.percentage.toFixed(1)}% · ${resultLabel[latest.result]}`}</strong><small>{formatDate(latest.periodStart)} · {latest.issueCount} issue{latest.issueCount === 1 ? "" : "s"}</small></div> : null}{currentRun ? <Link className="button button--primary" href={`/checks/${currentRun.id}`}><Clock3 aria-hidden="true" size={16} /> {currentRun.status === "draft" || currentRun.status === "reopened" ? "Continue current check" : "View current check"}</Link> : <form action={startKitchenCheck}><input name="templateId" type="hidden" value={template.id} /><input name="periodStart" type="hidden" value={periodStart} /><button className="button button--primary" type="submit"><CalendarCheck2 aria-hidden="true" size={16} /> Start {template.cadence === "weekly" ? `w/c ${formatDate(periodStart)}` : `today · ${formatDate(periodStart)}`}</button></form>}</div></article>;
        })}
        {!templates.length ? <section className="panel empty-state"><ClipboardCheck aria-hidden="true" size={24} /><h2>No kitchen-specific templates yet.</h2><p>Templates are deliberately tied to a site so Dough Religion, Kardia and Choi Wan can each have different checks.</p></section> : null}
      </section>

      {runs.length ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Check history</h2><p className="panel__subtitle">Drafts, submitted checks and management reviews</p></div></div><div className="report-list">{runs.slice(0, 30).map((run) => <Link className="report-row" href={`/checks/${run.id}`} key={run.id}><div className="site-cell"><div className="site-cell__mark">{run.cadence === "daily" ? "D" : "W"}</div><div><div className="site-cell__name">{run.templateName}</div><div className="site-cell__manager">{run.siteName} · {formatDate(run.periodStart)}</div></div></div><div><span className="report-row__metric-label">Score</span>{run.percentage === null ? "—" : `${run.percentage.toFixed(1)}%`}</div><div><span className="report-row__metric-label">Issues</span>{run.issueCount}</div><span className={`status-badge status-badge--${run.result === "pass" ? "approved" : run.result === "watch" ? "review_required" : run.result === "fail" ? "returned" : "draft"}`}>{resultLabel[run.result]}</span></Link>)}</div></section> : null}
    </>
  );
}

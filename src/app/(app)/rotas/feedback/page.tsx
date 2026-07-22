import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { ShiftFeedbackForm } from "@/components/rotas/shift-feedback-form";
import { requireSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "Shift feedback" };

type Params = { site?: string; date?: string };

type DailySales = {
  business_date: string;
  net_sales: number | string;
  imported_at: string;
};

type DailyLabour = {
  business_date: string;
  scheduled_hours: number | string;
  actual_hours: number | string;
  scheduled_hourly_cost: number | string;
  actual_hourly_cost: number | string;
  salary_cost_allocated: number | string;
  imported_at: string;
};

type FeedbackRow = {
  id: string;
  business_date: string;
  staffing_rating: string;
  affected_periods: string[];
  causes: string[];
  service_impact: string;
  would_repeat: boolean | null;
  notes: string;
  created_at: string;
};

const londonToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const ratingLabel = (value: string) => ({
  very_under: "Very understaffed",
  slightly_under: "Slightly understaffed",
  about_right: "About right",
  slightly_over: "Slightly overstaffed",
  very_over: "Very overstaffed",
}[value] ?? value.replaceAll("_", " "));

const numberValue = (value: number | string | null | undefined) => Number(value ?? 0);

export default async function RotaFeedbackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [profile, params] = await Promise.all([requireSessionProfile(), searchParams]);
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) return <AccessDenied />;

  const admin = createAdminClient();
  const { data: rawSites } = await admin
    .from("sites")
    .select("id, name")
    .eq("organisation_id", profile.organisationId)
    .eq("active", true)
    .order("name");
  const sites = (rawSites ?? []).filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
  const selectedSite = sites.find((site) => site.id === params.site) ?? sites[0] ?? null;
  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : londonToday();

  if (!selectedSite) {
    return <section className="panel empty-state"><h1>No kitchen is available.</h1><p>Ask an administrator to check your site access.</p></section>;
  }

  const historyStart = new Date(`${businessDate}T12:00:00Z`);
  historyStart.setUTCDate(historyStart.getUTCDate() - 30);
  const fromDate = historyStart.toISOString().slice(0, 10);
  const [feedbackResult, salesResult, labourResult] = await Promise.all([
    admin.from("rota_shift_feedback").select("id,business_date,staffing_rating,affected_periods,causes,service_impact,would_repeat,notes,created_at").eq("site_id", selectedSite.id).gte("business_date", fromDate).lte("business_date", businessDate).order("business_date", { ascending: false }).order("created_at", { ascending: false }),
    admin.from("daily_site_metrics").select("business_date,net_sales,imported_at").eq("site_id", selectedSite.id).eq("has_sales", true).gte("business_date", fromDate).lte("business_date", businessDate).order("imported_at"),
    admin.from("rota_daily_labour_history").select("business_date,scheduled_hours,actual_hours,scheduled_hourly_cost,actual_hourly_cost,salary_cost_allocated,imported_at").eq("site_id", selectedSite.id).gte("business_date", fromDate).lte("business_date", businessDate).order("imported_at"),
  ]);

  const salesByDate = new Map<string, DailySales>();
  for (const row of (salesResult.data ?? []) as DailySales[]) salesByDate.set(row.business_date, row);
  const labourByDate = new Map<string, DailyLabour>();
  for (const row of (labourResult.data ?? []) as DailyLabour[]) labourByDate.set(row.business_date, row);
  const feedback = (feedbackResult.data ?? []) as FeedbackRow[];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Rota learning loop</p>
          <h1 className="page-header__title">Shift feedback.</h1>
          <p className="page-header__copy">Capture whether cover felt right, then compare judgement with actual sales and worked labour. Repeated evidence—not one comment—will guide future calibration.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href={`/rotas?site=${selectedSite.id}`}><ArrowLeft aria-hidden="true" size={16} /> Back to rota planner</Link>
        </div>
      </header>

      <form className="rota-filters panel" method="get">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={selectedSite.id} name="site">{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Shift date</span><input className="field__input" defaultValue={businessDate} max={londonToday()} name="date" type="date" /></label>
        <button className="button button--secondary" type="submit"><MessageSquareText aria-hidden="true" size={16} /> Load shift</button>
      </form>

      <div className="report-detail-grid">
        <ShiftFeedbackForm businessDate={businessDate} siteId={selectedSite.id} />
        <section className="stack">
          <article className="form-section">
            <p className="page-header__eyebrow">Evidence for {formatDate(businessDate)}</p>
            <h2>What the systems recorded</h2>
            <div className="cost-summary">
              <EvidenceRow label="Net sales" value={salesByDate.has(businessDate) ? formatCurrency(numberValue(salesByDate.get(businessDate)?.net_sales)) : "Not imported"} />
              <EvidenceRow label="Scheduled hours" value={labourByDate.has(businessDate) ? `${numberValue(labourByDate.get(businessDate)?.scheduled_hours).toFixed(1)}h` : "Not imported"} />
              <EvidenceRow label="Actual hours" value={labourByDate.has(businessDate) ? `${numberValue(labourByDate.get(businessDate)?.actual_hours).toFixed(1)}h` : "Not imported"} />
              <EvidenceRow label="Scheduled hourly cost" value={labourByDate.has(businessDate) ? formatCurrency(numberValue(labourByDate.get(businessDate)?.scheduled_hourly_cost)) : "Not imported"} />
              <EvidenceRow label="Actual hourly cost" value={labourByDate.has(businessDate) ? formatCurrency(numberValue(labourByDate.get(businessDate)?.actual_hourly_cost)) : "Not imported"} />
              <EvidenceRow label="Allocated salary cost" value={labourByDate.has(businessDate) ? formatCurrency(numberValue(labourByDate.get(businessDate)?.salary_cost_allocated)) : "Not imported"} />
            </div>
          </article>
          <div className="privacy-callout">Individual pay remains in the private payroll schema. This page only uses site-level daily totals.</div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel__header"><div><h2 className="panel__title">Recent shift feedback</h2><p className="panel__subtitle">Last 30 days for {selectedSite.name}</p></div></div>
        {feedback.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Staffing</th><th>Impact</th><th>Repeat?</th><th>Evidence tags</th><th>Note</th></tr></thead>
              <tbody>{feedback.map((row) => <tr key={row.id}><td>{formatDate(row.business_date)}</td><td>{ratingLabel(row.staffing_rating)}</td><td>{row.service_impact}</td><td>{row.would_repeat == null ? "Unsure" : row.would_repeat ? "Yes" : "No"}</td><td>{[...row.affected_periods, ...row.causes].map((value) => value.replaceAll("_", " ")).join(" · ") || "—"}</td><td>{row.notes || "—"}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="panel__body muted-text">No feedback has been submitted for this kitchen yet.</div>}
      </section>
    </>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return <div className="cost-summary__row"><span className="cost-summary__label">{label}</span><strong className="cost-summary__value">{value}</strong></div>;
}

function AccessDenied() {
  return <section className="panel empty-state"><h1>Shift feedback is not available for this role.</h1><p>Ask an administrator if you need operational rota access.</p></section>;
}

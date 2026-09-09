import Link from "next/link";
import { ArrowLeft, BrainCircuit, Download, ShieldCheck } from "lucide-react";
import { GroupMasterUploader } from "@/components/reports/group-master-uploader";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "Group master reporting" };

const prettyMetric = (value: string) => ({
  net_sales: "Net sales",
  gross_sales: "Gross sales",
  purchases: "Purchases",
  credits: "Credits",
  staff_cost: "Staff cost",
  paid_hours: "Paid hours",
  pending_credits: "Pending credits",
  awaiting_invoice: "Awaiting invoice",
}[value] ?? value.replaceAll("_", " "));

export default async function GroupReportingPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const [profile, params] = await Promise.all([
    requireGroupWorkspaceRole(["admin", "group_manager"]),
    searchParams,
  ]);
  const fallback = getLatestCompletedReportingWeek();
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? "") ? params.week! : fallback.start;
  const supabase = await createServerSupabaseClient();
  const [batchResult, reconciliationResult, siteResult] = supabase ? await Promise.all([
    supabase.from("weekly_upload_batches").select("id, status, created_at").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).eq("batch_kind", "group").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("weekly_reconciliations").select("site_id, metric_key, site_value, master_value, variance, variance_pct, status").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).order("site_id"),
    supabase.from("sites").select("id, name").eq("organisation_id", profile.organisationId).eq("active", true).order("name"),
  ]) : [{ data: null }, { data: [] }, { data: [] }];
  const sitesById = new Map((siteResult.data ?? []).map((site) => [site.id, site.name]));
  const activeSiteNames = (siteResult.data ?? []).map((site) => site.name);
  const rows = reconciliationResult.data ?? [];
  const warnings = rows.filter((row) => row.status !== "match");
  const matches = rows.filter((row) => row.status === "match");

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Group Chef · independent source</p>
          <h1 className="page-header__title">Master weekly pack.</h1>
          <p className="page-header__copy">Upload the independent group exports after the kitchens submit. The platform tells you exactly what it needs, cross-checks the KM figures and feeds only management-trusted data into Decision Desk.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> Weekly reports</Link>
          <Link className="button button--secondary" href="/intelligence"><BrainCircuit aria-hidden="true" size={16} /> Decision Desk</Link>
          <a className="button button--primary" href={`/api/intelligence/export?week=${weekStart}`}><Download aria-hidden="true" size={16} /> Download AI review pack</a>
        </div>
      </header>

      <div className="privacy-callout" style={{ marginBottom: "1rem" }}><ShieldCheck aria-hidden="true" className="privacy-callout__icon" size={16} />This workspace is group-management only. Master files never overwrite the figures entered by a kitchen.</div>

      <GroupMasterUploader activeSites={activeSiteNames} weekStart={weekStart} />

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel__header">
          <div><h2 className="panel__title">Latest reconciliation</h2><p className="panel__subtitle">Week commencing {formatDate(weekStart)} · {batchResult.data ? `master batch ${batchResult.data.status}` : "no group batch yet"}</p></div>
          <div className="source-chip source-chip--safe">{matches.length} matched · {warnings.length} exceptions</div>
        </div>
        <div className="panel__body">
          {rows.length ? (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Kitchen</th><th>Metric</th><th>Site submission</th><th>Master source</th><th>Variance</th><th>Status</th></tr></thead><tbody>
              {rows.map((row) => {
                const money = row.metric_key !== "paid_hours";
                const format = (value: number | string | null) => value == null ? "—" : money ? formatCurrency(Number(value)) : Number(value).toFixed(2);
                return <tr key={`${row.site_id}-${row.metric_key}`}><td><strong>{sitesById.get(row.site_id) ?? "Kitchen"}</strong></td><td>{prettyMetric(row.metric_key)}</td><td>{format(row.site_value)}</td><td>{format(row.master_value)}</td><td>{format(row.variance)}</td><td><span className={`rag-chip rag-chip--${row.status === "match" ? "green" : "red"}`}>{row.status.replaceAll("_", " ")}</span></td></tr>;
              })}
            </tbody></table></div>
          ) : <div className="empty-inline">Upload the four core reports for each kitchen to create the first independent cross-check for this week.</div>}
        </div>
      </section>
    </>
  );
}

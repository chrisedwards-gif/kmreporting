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
  const [batchResult, reconciliationResult, siteResult, externalResult] = supabase ? await Promise.all([
    supabase.from("weekly_upload_batches").select("id, status, created_at").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).eq("batch_kind", "group").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("weekly_reconciliations").select("site_id, metric_key, site_value, master_value, variance, variance_pct, status").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).order("site_id"),
    supabase.from("sites").select("id, name, master_sales_expected, master_purchasing_expected, master_labour_expected").eq("organisation_id", profile.organisationId).eq("active", true).order("name"),
    supabase.from("external_brand_weekly_sales").select("brand_name, gross_sales, net_sales, captured_at").eq("organisation_id", profile.organisationId).eq("week_start", weekStart).order("net_sales", { ascending: false }),
  ]) : [{ data: null }, { data: [] }, { data: [] }, { data: [] }];
  const sitesById = new Map((siteResult.data ?? []).map((site) => [site.id, site.name]));
  const activeSiteNames = (siteResult.data ?? []).map((site) => site.name);
  const sourceExceptions = (siteResult.data ?? [])
    .filter((site) => !site.master_purchasing_expected || !site.master_labour_expected)
    .map((site) => ({
      siteName: site.name,
      purchasingMasterExpected: site.master_purchasing_expected,
      labourMasterExpected: site.master_labour_expected,
    }));
  const competitorRows = externalResult.data ?? [];
  const rows = reconciliationResult.data ?? [];
  const matches = rows.filter((row) => row.status === "match");
  const awaitingKm = rows.filter((row) => row.status === "missing_site");
  const reviewIssues = rows.filter((row) => row.status === "warning" || row.status === "missing_master");

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Group Chef · independent HOS source</p>
          <h1 className="page-header__title">Master weekly pack.</h1>
          <p className="page-header__copy">Upload the HOS-wide reports you already have once. Active kitchens are reconciled against KM submissions, while valid StockLink reports for non-HOS brands are retained as competitor benchmarks instead of being rejected.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> KM report status</Link>
          <Link className="button button--secondary" href="/reports/new?mode=site">Single-kitchen override</Link>
          <Link className="button button--secondary" href="/intelligence"><BrainCircuit aria-hidden="true" size={16} /> Decision Desk</Link>
          <a className="button button--primary" href={`/api/intelligence/export?week=${weekStart}`}><Download aria-hidden="true" size={16} /> Download AI review pack</a>
        </div>
      </header>

      <div className="privacy-callout" style={{ marginBottom: "1rem" }}><ShieldCheck aria-hidden="true" className="privacy-callout__icon" size={16} />This is your Group Chef source, not a KM report. Uploading here never overwrites a kitchen submission; it gives you an independent dataset to check it against.</div>

      <GroupMasterUploader activeSites={activeSiteNames} sourceExceptions={sourceExceptions} weekStart={weekStart} />

      {competitorRows.length ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel__header">
            <div><h2 className="panel__title">Competitor benchmarks captured</h2><p className="panel__subtitle">Valid Access / StockLink reports for brands outside the active HOS kitchen list · week commencing {formatDate(weekStart)}</p></div>
            <div className="source-chip">{competitorRows.length} tracked</div>
          </div>
          <div className="panel__body">
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Brand</th><th>Net sales</th><th>Gross sales</th><th>Captured</th></tr></thead><tbody>
              {competitorRows.map((row) => <tr key={row.brand_name}><td><strong>{row.brand_name}</strong></td><td>{formatCurrency(Number(row.net_sales))}</td><td>{row.gross_sales == null ? "—" : formatCurrency(Number(row.gross_sales))}</td><td>{new Date(row.captured_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td></tr>)}
            </tbody></table></div>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel__header">
          <div><h2 className="panel__title">Live reconciliation</h2><p className="panel__subtitle">Week commencing {formatDate(weekStart)} · {batchResult.data ? `master batch ${batchResult.data.status}` : "no Group Chef master pack yet"}</p></div>
          <div className="source-chip source-chip--safe">{matches.length} matched · {awaitingKm.length} awaiting KM · {reviewIssues.length} review</div>
        </div>
        <div className="panel__body">
          {rows.length ? (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Kitchen</th><th>Metric</th><th>KM submission</th><th>Your master source</th><th>Variance</th><th>Status</th></tr></thead><tbody>
              {rows.map((row) => {
                const money = row.metric_key !== "paid_hours";
                const format = (value: number | string | null) => value == null ? "—" : money ? formatCurrency(Number(value)) : Number(value).toFixed(2);
                const statusLabel = row.status === "missing_site" ? "awaiting KM" : row.status === "missing_master" ? "missing master" : row.status;
                return <tr key={`${row.site_id}-${row.metric_key}`}><td><strong>{sitesById.get(row.site_id) ?? "Kitchen"}</strong></td><td>{prettyMetric(row.metric_key)}</td><td>{format(row.site_value)}</td><td>{format(row.master_value)}</td><td>{format(row.variance)}</td><td>{row.status === "match" ? <span className="rag-chip rag-chip--green">match</span> : row.status === "missing_site" ? <span className="source-chip">{statusLabel}</span> : <span className="rag-chip rag-chip--red">{statusLabel}</span>}</td></tr>;
              })}
            </tbody></table></div>
          ) : <div className="empty-inline">Upload your HOS-wide group exports once. Only metrics with an applicable independent master source are reconciled; source-exception metrics remain owned by the KM submission.</div>}
        </div>
      </section>
    </>
  );
}

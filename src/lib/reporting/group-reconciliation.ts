import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type GroupReconciliationRow = {
  siteId: string;
  siteName: string;
  metricKey: string;
  siteValue: number | null;
  masterValue: number | null;
  variance: number | null;
  variancePct: number | null;
  status: "match" | "warning" | "missing_site" | "missing_master";
};

type SiteRow = { id: string; name: string; code?: string };
type AdminClient = ReturnType<typeof createAdminClient>;

export async function reconcileLatestGroupMaster({ organisationId, weekStart }: { organisationId: string; weekStart: string }) {
  const admin = createAdminClient();
  const [{ data: batch }, { data: sites = [] }] = await Promise.all([
    admin
      .from("weekly_upload_batches")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("week_start", weekStart)
      .eq("batch_kind", "group")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("sites").select("id, name, code").eq("organisation_id", organisationId).eq("active", true).order("name"),
  ]);
  if (!batch || !sites?.length) return [];
  return reconcileGroupMasterBatch({ organisationId, weekStart, batchId: batch.id, sites: sites as SiteRow[], admin });
}

export async function reconcileGroupMasterBatch({
  organisationId,
  weekStart,
  batchId,
  sites,
  admin = createAdminClient(),
}: {
  organisationId: string;
  weekStart: string;
  batchId: string;
  sites: SiteRow[];
  admin?: AdminClient;
}): Promise<GroupReconciliationRow[]> {
  const { data: period } = await admin
    .from("reporting_periods")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("week_start", weekStart)
    .eq("reporting_cycle", "sunday_saturday")
    .maybeSingle();
  const { data: masterRows = [] } = await admin
    .from("weekly_master_metrics")
    .select("site_id, metric_key, numeric_value")
    .eq("batch_id", batchId);

  const masterBySite = new Map<string, Map<string, number>>();
  for (const row of masterRows ?? []) {
    const map = masterBySite.get(row.site_id) ?? new Map<string, number>();
    map.set(row.metric_key, Number(row.numeric_value));
    masterBySite.set(row.site_id, map);
  }

  const { data: reports = [] } = period?.id
    ? await admin.from("weekly_reports").select("id, site_id").eq("period_id", period.id)
    : { data: [] };
  const reportIds = (reports ?? []).map((report) => report.id);
  const reportBySite = new Map((reports ?? []).map((report) => [report.site_id, report.id]));
  const { data: sourceRows = [] } = reportIds.length
    ? await admin
      .from("report_source_values")
      .select("report_id, net_sales, purchases, credits, staff_cost, paid_hours, pending_credits, awaiting_invoice")
      .in("report_id", reportIds)
    : { data: [] };
  const sourceByReport = new Map((sourceRows ?? []).map((row) => [row.report_id, row]));

  const keys = ["net_sales", "purchases", "credits", "staff_cost", "paid_hours", "pending_credits", "awaiting_invoice"] as const;
  const databaseRows: Array<Record<string, unknown>> = [];
  const response: GroupReconciliationRow[] = [];

  for (const site of sites) {
    const reportId = reportBySite.get(site.id) ?? null;
    const source = reportId ? sourceByReport.get(reportId) : null;
    const master = masterBySite.get(site.id) ?? new Map<string, number>();
    for (const key of keys) {
      const masterValue = master.has(key) ? master.get(key)! : null;
      const rawSite = source ? source[key] : null;
      const siteValue = rawSite == null ? null : Number(rawSite);
      if (masterValue == null && siteValue == null) continue;
      const variance = masterValue != null && siteValue != null ? masterValue - siteValue : null;
      const variancePct = variance != null && siteValue != null && siteValue !== 0 ? variance / Math.abs(siteValue) * 100 : null;
      const status = siteValue == null
        ? "missing_site" as const
        : masterValue == null
          ? "missing_master" as const
          : metricMatches(key, siteValue, masterValue)
            ? "match" as const
            : "warning" as const;
      response.push({ siteId: site.id, siteName: site.name, metricKey: key, siteValue, masterValue, variance, variancePct, status });
      databaseRows.push({
        organisation_id: organisationId,
        week_start: weekStart,
        site_id: site.id,
        report_id: reportId,
        master_batch_id: batchId,
        metric_key: key,
        site_value: siteValue,
        master_value: masterValue,
        variance,
        variance_pct: variancePct,
        status,
        checked_at: new Date().toISOString(),
      });
    }
  }

  await admin.from("weekly_reconciliations").delete().eq("organisation_id", organisationId).eq("week_start", weekStart);
  if (databaseRows.length) {
    const { error } = await admin.from("weekly_reconciliations").insert(databaseRows);
    if (error) throw new Error(`Could not refresh group reconciliation: ${error.message}`);
  }
  return response;
}

function metricMatches(key: string, siteValue: number, masterValue: number) {
  const absolute = Math.abs(masterValue - siteValue);
  const pctVariance = siteValue !== 0 ? absolute / Math.abs(siteValue) * 100 : absolute === 0 ? 0 : 100;
  if (key === "paid_hours") return absolute <= 0.25 || pctVariance <= 0.5;
  return absolute <= 2 || pctVariance <= 0.25;
}

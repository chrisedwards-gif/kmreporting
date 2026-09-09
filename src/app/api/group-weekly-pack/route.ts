import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionProfile } from "@/lib/auth/dal";
import { normaliseSiteName } from "@/lib/reporting/imports";
import { classifyWeeklyPackFile, type ParsedPackFile } from "@/lib/reporting/pack-parser";
import { isSundayToSaturday } from "@/lib/reporting/periods";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxFiles = 80;
const maxFileBytes = 25 * 1024 * 1024;
const maxBatchBytes = 400 * 1024 * 1024;

const safeFileName = (value: string) => value
  .normalize("NFKD")
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^[-.]+|[-.]+$/g, "")
  .slice(0, 140) || "report-file";

const saturdayAfter = (sunday: string) => {
  const date = new Date(`${sunday}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
};

const decodeReportText = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);
const numeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type SiteRow = { id: string; name: string; code: string };
type MasterMetric = { siteId: string; metricKey: string; numericValue: number; sourceFileId: string };

type ParsedFileRow = {
  fileName: string;
  fileId: string;
  parsed: ParsedPackFile;
  site: SiteRow | null;
};

export async function POST(request: NextRequest) {
  const profile = await requireSessionProfile();
  if (!(["admin", "group_manager"] as string[]).includes(profile.actualRole) || profile.isAccessPreview) {
    return NextResponse.json({ error: "Group master uploads are restricted to group management." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  const weekStart = String(form.get("weekStart") ?? "");
  const weekEnd = saturdayAfter(weekStart);
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!weekStart || !weekEnd || !isSundayToSaturday(weekStart, weekEnd)) {
    return NextResponse.json({ error: "Choose a valid Sunday-to-Saturday reporting week." }, { status: 400 });
  }
  if (!files.length) return NextResponse.json({ error: "Drop at least one group source file." }, { status: 400 });
  if (files.length > maxFiles) return NextResponse.json({ error: `Upload no more than ${maxFiles} files at once.` }, { status: 400 });
  if (files.some((file) => file.size > maxFileBytes)) return NextResponse.json({ error: "One of the files is larger than 25 MB." }, { status: 413 });
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBatchBytes) return NextResponse.json({ error: "The full group upload is larger than 400 MB." }, { status: 413 });

  const admin = createAdminClient();
  const { data: sites = [], error: sitesError } = await admin
    .from("sites")
    .select("id, name, code")
    .eq("organisation_id", profile.organisationId)
    .eq("active", true)
    .order("name");
  if (sitesError || !sites?.length) return NextResponse.json({ error: "No active kitchens are available for reconciliation." }, { status: 409 });
  const siteRows = sites as SiteRow[];

  const { data: batch, error: batchError } = await admin.from("weekly_upload_batches").insert({
    organisation_id: profile.organisationId,
    site_id: null,
    week_start: weekStart,
    week_end: weekEnd,
    batch_kind: "group",
    status: "processing",
    uploaded_by: profile.id,
  }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "The group upload batch could not be created." }, { status: 500 });

  const expected = { start: weekStart, end: weekEnd };
  const parsedRows: ParsedFileRow[] = [];
  const metrics: MasterMetric[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileId = randomUUID();
    const storagePath = `${profile.organisationId}/${weekStart}/group/${batch.id}/${fileId}-${safeFileName(file.name)}`;
    const contentType = file.type || "application/octet-stream";
    const { error: storageError } = await admin.storage.from("weekly-report-packs").upload(storagePath, bytes, { contentType, upsert: false });
    if (storageError) {
      await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
      return NextResponse.json({ error: `Could not retain ${file.name} privately.`, batchId: batch.id }, { status: 500 });
    }

    const parsed = classifyWeeklyPackFile(file.name, decodeReportText(bytes), expected);
    const site = resolveSite(parsed.siteHint, file.name, siteRows);
    const effectiveParsed: ParsedPackFile = parsed.parseStatus === "parsed" && !site
      ? { ...parsed, parseStatus: "error", error: parsed.siteHint ? `Could not match ${parsed.siteHint} to an active kitchen.` : "The kitchen could not be identified from this file." }
      : parsed;

    const { error: fileError } = await admin.from("weekly_upload_files").insert({
      id: fileId,
      batch_id: batch.id,
      file_name: file.name,
      storage_path: storagePath,
      content_type: contentType,
      byte_size: file.size,
      sha256,
      classification: effectiveParsed.classification,
      parse_status: effectiveParsed.parseStatus,
      site_hint: site?.name ?? effectiveParsed.siteHint,
      period_start: effectiveParsed.periodStart,
      period_end: effectiveParsed.periodEnd,
      parsed_summary: effectiveParsed.summary,
      parse_error: effectiveParsed.error,
    });
    if (fileError) {
      await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
      return NextResponse.json({ error: `Could not register ${file.name} in the audit trail.`, batchId: batch.id }, { status: 500 });
    }

    parsedRows.push({ fileName: file.name, fileId, parsed: effectiveParsed, site });
    if (site && effectiveParsed.parseStatus === "parsed") {
      metrics.push(...metricsForFile(site.id, fileId, effectiveParsed));
    }
  }

  if (metrics.length) {
    const deduped = new Map<string, MasterMetric>();
    for (const metric of metrics) deduped.set(`${metric.siteId}:${metric.metricKey}`, metric);
    const rows = [...deduped.values()].map((metric) => ({
      batch_id: batch.id,
      source_file_id: metric.sourceFileId,
      site_id: metric.siteId,
      metric_key: metric.metricKey,
      numeric_value: metric.numericValue,
    }));
    const { error: metricError } = await admin.from("weekly_master_metrics").upsert(rows, { onConflict: "batch_id,site_id,metric_key" });
    if (metricError) {
      await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
      return NextResponse.json({ error: "The master metrics could not be stored.", batchId: batch.id }, { status: 500 });
    }
  }

  const reconciliation = await reconcileWeek({
    organisationId: profile.organisationId,
    weekStart,
    batchId: batch.id,
    sites: siteRows,
    admin,
  });

  await admin.from("weekly_upload_batches").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", batch.id);
  await admin.from("audit_log").insert({
    organisation_id: profile.organisationId,
    actor_id: profile.id,
    action: "weekly_master_pack.uploaded",
    entity_type: "weekly_upload_batch",
    entity_id: batch.id,
    detail: {
      week_start: weekStart,
      file_count: files.length,
      parsed_count: parsedRows.filter((row) => row.parsed.parseStatus === "parsed").length,
      metric_count: metrics.length,
      warning_count: reconciliation.filter((row) => row.status !== "match").length,
    },
  });

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    weekStart,
    parsed: parsedRows.map((row) => ({
      name: row.fileName,
      site: row.site?.name ?? row.parsed.siteHint,
      classification: row.parsed.classification,
      status: row.parsed.parseStatus,
      error: row.parsed.error,
      summary: row.parsed.summary,
    })),
    reconciliation,
  });
}

function resolveSite(siteHint: string | null, fileName: string, sites: SiteRow[]) {
  const hint = siteHint ? normaliseSiteName(siteHint) : "";
  if (hint) {
    const exact = sites.find((site) => normaliseSiteName(site.name) === hint || normaliseSiteName(site.code) === hint);
    if (exact) return exact;
    const fuzzy = sites.find((site) => hint.includes(normaliseSiteName(site.name)) || normaliseSiteName(site.name).includes(hint));
    if (fuzzy) return fuzzy;
  }
  const name = normaliseSiteName(fileName.replace(/\.[^.]+$/, ""));
  return sites.find((site) => name.includes(normaliseSiteName(site.name)) || name.includes(normaliseSiteName(site.code))) ?? null;
}

function metricsForFile(siteId: string, sourceFileId: string, parsed: ParsedPackFile): MasterMetric[] {
  const rows: MasterMetric[] = [];
  const add = (metricKey: string, value: unknown) => {
    const numericValue = numeric(value);
    if (numericValue != null) rows.push({ siteId, metricKey, numericValue, sourceFileId });
  };
  if (parsed.classification === "sales_eow") {
    add("net_sales", parsed.summary.netSales);
    add("gross_sales", parsed.summary.grossSales);
  }
  if (parsed.classification === "procure_goods") {
    add("purchases", parsed.summary.purchases);
    add("awaiting_invoice", parsed.summary.awaitingInvoice);
  }
  if (parsed.classification === "procure_credits") {
    add("credits", parsed.summary.confirmedCredits);
    add("pending_credits", parsed.summary.pendingCredits);
  }
  if (parsed.classification === "rotacloud_labour") {
    add("staff_cost", parsed.summary.staffCost);
    add("paid_hours", parsed.summary.paidHours);
  }
  return rows;
}

async function reconcileWeek({ organisationId, weekStart, batchId, sites, admin }: {
  organisationId: string;
  weekStart: string;
  batchId: string;
  sites: SiteRow[];
  admin: ReturnType<typeof createAdminClient>;
}) {
  const { data: period } = await admin.from("reporting_periods").select("id").eq("organisation_id", organisationId).eq("week_start", weekStart).eq("reporting_cycle", "sunday_saturday").maybeSingle();
  const { data: masterRows = [] } = await admin.from("weekly_master_metrics").select("site_id, metric_key, numeric_value").eq("batch_id", batchId);
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
    ? await admin.from("report_source_values").select("report_id, net_sales, purchases, credits, staff_cost, paid_hours, pending_credits, awaiting_invoice").in("report_id", reportIds)
    : { data: [] };
  const sourceByReport = new Map((sourceRows ?? []).map((row) => [row.report_id, row]));

  const keys = ["net_sales", "purchases", "credits", "staff_cost", "paid_hours", "pending_credits", "awaiting_invoice"] as const;
  const reconciliationRows: Array<Record<string, unknown>> = [];
  const response: Array<{ siteId: string; siteName: string; metricKey: string; siteValue: number | null; masterValue: number | null; variance: number | null; variancePct: number | null; status: "match" | "warning" | "missing_site" | "missing_master" }> = [];

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
      const row = { siteId: site.id, siteName: site.name, metricKey: key, siteValue, masterValue, variance, variancePct, status };
      response.push(row);
      reconciliationRows.push({
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

  if (reconciliationRows.length) {
    await admin.from("weekly_reconciliations").upsert(reconciliationRows, { onConflict: "organisation_id,week_start,site_id,metric_key" });
  }
  return response;
}

function metricMatches(key: string, siteValue: number, masterValue: number) {
  const absolute = Math.abs(masterValue - siteValue);
  const pctVariance = siteValue !== 0 ? absolute / Math.abs(siteValue) * 100 : absolute === 0 ? 0 : 100;
  if (key === "paid_hours") return absolute <= 0.25 || pctVariance <= 0.5;
  return absolute <= 2 || pctVariance <= 0.25;
}
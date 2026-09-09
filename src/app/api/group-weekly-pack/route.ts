import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionProfile } from "@/lib/auth/dal";
import { parseGroupWeeklyPackFile } from "@/lib/reporting/group-pack-parser";
import { reconcileGroupMasterBatch } from "@/lib/reporting/group-reconciliation";
import { normaliseSiteName } from "@/lib/reporting/imports";
import type { ParsedPackFile } from "@/lib/reporting/pack-parser";
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

type SiteRow = {
  id: string;
  name: string;
  code: string;
  master_sales_expected: boolean;
  master_purchasing_expected: boolean;
  master_labour_expected: boolean;
};
type MasterMetric = { siteId: string; metricKey: string; numericValue: number; sourceFileId: string };
type ResolvedParse = { parsed: ParsedPackFile; site: SiteRow | null; externalBrand?: string };
type ParsedFileRow = {
  fileName: string;
  fileId: string;
  classification: ParsedPackFile["classification"];
  status: ParsedPackFile["parseStatus"];
  error: string;
  summary: Record<string, unknown>;
  sites: SiteRow[];
  externalBrands: string[];
};
type HourlyMetric = {
  siteId: string;
  businessDate: string;
  slotTime: string;
  staffedHours: number;
  staffCount: number;
  hourlyCost: number;
  sourceReference: string;
};
type ExternalBrandSales = {
  sourceFileId: string;
  brandKey: string;
  brandName: string;
  grossSales: number | null;
  vat: number | null;
  serviceCharge: number | null;
  netSales: number;
  salesInsights: ParsedPackFile["salesInsights"];
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
    .select("id, name, code, master_sales_expected, master_purchasing_expected, master_labour_expected")
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
  const hourlyMetrics: HourlyMetric[] = [];
  const externalBrandSales: ExternalBrandSales[] = [];
  const rotaSitesSeen = new Set<string>();

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileId = randomUUID();
    const storagePath = `${profile.organisationId}/${weekStart}/group/${batch.id}/${fileId}-${safeFileName(file.name)}`;
    const contentType = file.type || "application/octet-stream";
    const { error: storageError } = await admin.storage.from("weekly-report-packs").upload(storagePath, bytes, { contentType, upsert: false });
    if (storageError) {
      await markBatchError(admin, batch.id);
      return NextResponse.json({ error: `Could not retain ${file.name} privately.`, batchId: batch.id }, { status: 500 });
    }

    const sourceResults = parseGroupWeeklyPackFile(file.name, decodeReportText(bytes), expected);
    const parsedResults = ensureGroupCreditCoverage(sourceResults, siteRows, expected);
    const resolved: ResolvedParse[] = parsedResults.map((parsed) => {
      const site = resolveSite(parsed.siteHint, parsedResults.length === 1 ? file.name : "", siteRows);
      if (parsed.parseStatus === "parsed" && !site) {
        const benchmark = externalSalesFromParsed(parsed, fileId);
        if (benchmark) {
          externalBrandSales.push(benchmark);
          return {
            site: null,
            externalBrand: benchmark.brandName,
            parsed: {
              ...parsed,
              summary: { ...parsed.summary, externalBenchmark: true, externalBrand: benchmark.brandName },
            },
          };
        }
        return {
          site: null,
          parsed: {
            ...parsed,
            parseStatus: "error",
            error: parsed.siteHint ? `Could not match ${parsed.siteHint} to an active kitchen.` : "The kitchen could not be identified from this file.",
          },
        };
      }
      return { parsed, site };
    });

    const successful = resolved.filter((row): row is ResolvedParse & { site: SiteRow } => row.parsed.parseStatus === "parsed" && Boolean(row.site));
    const external = resolved.filter((row): row is ResolvedParse & { externalBrand: string } => row.parsed.parseStatus === "parsed" && Boolean(row.externalBrand));
    const first = resolved[0]?.parsed;
    const classification = first?.classification ?? "supporting";
    const status: ParsedPackFile["parseStatus"] = successful.length || external.length
      ? "parsed"
      : resolved.some((row) => row.parsed.parseStatus === "error")
        ? "error"
        : first?.parseStatus ?? "unrecognised";
    const errors = resolved
      .filter((row) => row.parsed.error)
      .map((row) => `${row.parsed.siteHint ? `${row.parsed.siteHint}: ` : ""}${row.parsed.error}`);
    const externalBrands = [...new Set(external.map((row) => row.externalBrand))];
    const summary = successful.length > 1 || parsedResults.length > 1
      ? {
        groupWideSource: true,
        kitchenCount: successful.length,
        kitchens: successful.map((row) => ({ site: row.site.name, summary: row.parsed.summary })),
        externalBrandCount: externalBrands.length,
        externalBrands: external.map((row) => ({ brand: row.externalBrand, summary: row.parsed.summary })),
      }
      : successful[0]?.parsed.summary ?? external[0]?.parsed.summary ?? first?.summary ?? {};
    const accepted = [...successful, ...external];
    const periods = accepted.flatMap((row) => [row.parsed.periodStart, row.parsed.periodEnd].filter((value): value is string => Boolean(value))).sort();
    const siteHint = successful.length === 1
      ? successful[0].site.name
      : successful.length > 1
        ? `${successful.length} kitchens`
        : externalBrands.length === 1
          ? externalBrands[0]
          : externalBrands.length > 1
            ? `${externalBrands.length} external brands`
            : first?.siteHint ?? null;

    const { error: fileError } = await admin.from("weekly_upload_files").insert({
      id: fileId,
      batch_id: batch.id,
      file_name: file.name,
      storage_path: storagePath,
      content_type: contentType,
      byte_size: file.size,
      sha256,
      classification,
      parse_status: status,
      site_hint: siteHint,
      period_start: periods[0] ?? first?.periodStart ?? null,
      period_end: periods.at(-1) ?? first?.periodEnd ?? null,
      parsed_summary: summary,
      parse_error: errors.join(" "),
    });
    if (fileError) {
      await markBatchError(admin, batch.id);
      return NextResponse.json({ error: `Could not register ${file.name} in the audit trail.`, batchId: batch.id }, { status: 500 });
    }

    for (const row of successful) {
      metrics.push(...metricsForFile(row.site.id, fileId, row.parsed));
      if (row.parsed.classification === "rotacloud_labour") {
        rotaSitesSeen.add(row.site.id);
        hourlyMetrics.push(...hourlyMetricsForFile(row.site.id, file.name, sha256, row.parsed));
      }
    }

    parsedRows.push({
      fileName: file.name,
      fileId,
      classification,
      status,
      error: errors.join(" "),
      summary,
      sites: successful.map((row) => row.site),
      externalBrands,
    });
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
      await markBatchError(admin, batch.id);
      return NextResponse.json({ error: "The master metrics could not be stored.", batchId: batch.id }, { status: 500 });
    }
  }

  if (externalBrandSales.length) {
    const deduped = new Map<string, ExternalBrandSales>();
    for (const row of externalBrandSales) deduped.set(row.brandKey, row);
    const { error: externalError } = await admin.from("external_brand_weekly_sales").upsert(
      [...deduped.values()].map((row) => ({
        organisation_id: profile.organisationId,
        week_start: weekStart,
        week_end: weekEnd,
        brand_key: row.brandKey,
        brand_name: row.brandName,
        source_file_id: row.sourceFileId,
        gross_sales: row.grossSales,
        vat: row.vat,
        service_charge: row.serviceCharge,
        net_sales: row.netSales,
        sales_insights: row.salesInsights ?? {},
        captured_at: new Date().toISOString(),
      })),
      { onConflict: "organisation_id,week_start,brand_key" },
    );
    if (externalError) {
      await markBatchError(admin, batch.id);
      return NextResponse.json({ error: "The competitor benchmark sales could not be stored.", batchId: batch.id }, { status: 500 });
    }
  }

  const hourlyError = await replaceGroupHourlyLabour({
    admin,
    organisationId: profile.organisationId,
    weekStart,
    weekEnd,
    siteIds: [...rotaSitesSeen],
    rows: hourlyMetrics,
  });
  if (hourlyError) {
    await markBatchError(admin, batch.id);
    return NextResponse.json({ error: hourlyError, batchId: batch.id }, { status: 500 });
  }

  let reconciliation;
  try {
    reconciliation = await reconcileGroupMasterBatch({
      organisationId: profile.organisationId,
      weekStart,
      batchId: batch.id,
      sites: siteRows,
      admin,
    });
  } catch (error) {
    await markBatchError(admin, batch.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The group reconciliation could not be refreshed.", batchId: batch.id }, { status: 500 });
  }

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
      parsed_file_count: parsedRows.filter((row) => row.status === "parsed").length,
      recognised_kitchen_count: new Set(parsedRows.flatMap((row) => row.sites.map((site) => site.id))).size,
      external_brand_count: new Set(externalBrandSales.map((row) => row.brandKey)).size,
      metric_count: metrics.length,
      hourly_labour_rows: hourlyMetrics.length,
      warning_count: reconciliation.filter((row) => row.status !== "match").length,
    },
  });

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    weekStart,
    parsed: parsedRows.map((row) => ({
      name: row.fileName,
      site: row.sites.length === 1 ? row.sites[0].name : null,
      sites: row.sites.map((site) => site.name),
      externalBrands: row.externalBrands,
      classification: row.classification,
      status: row.status,
      error: row.error,
      summary: row.summary,
    })),
    reconciliation,
  });
}

function ensureGroupCreditCoverage(results: ParsedPackFile[], sites: SiteRow[], expected: { start: string; end: string }) {
  if (!results.length || !results.every((row) => row.classification === "procure_credits")) return results;
  const present = new Set(results.map((row) => row.siteHint ? normaliseSiteName(row.siteHint) : "").filter(Boolean));
  const additions = sites
    .filter((site) => site.master_purchasing_expected && !present.has(normaliseSiteName(site.name)) && !present.has(normaliseSiteName(site.code)))
    .map<ParsedPackFile>((site) => ({
      classification: "procure_credits",
      parseStatus: "parsed",
      siteHint: site.name,
      periodStart: expected.start,
      periodEnd: expected.end,
      summary: {
        confirmedCredits: 0,
        pendingCredits: 0,
        confirmedCount: 0,
        pendingCount: 0,
        groupWideSource: true,
        zeroEvidence: true,
      },
      error: "",
    }));
  return [...results.filter((row) => row.siteHint || row.parseStatus === "error"), ...additions];
}

function externalSalesFromParsed(parsed: ParsedPackFile, sourceFileId: string): ExternalBrandSales | null {
  if (parsed.classification !== "sales_eow" || parsed.parseStatus !== "parsed" || !parsed.siteHint) return null;
  const netSales = numeric(parsed.summary.netSales);
  if (netSales == null || netSales <= 0) return null;
  return {
    sourceFileId,
    brandKey: normaliseSiteName(parsed.siteHint),
    brandName: parsed.siteHint.trim(),
    grossSales: numeric(parsed.summary.grossSales),
    vat: numeric(parsed.summary.vat),
    serviceCharge: numeric(parsed.summary.serviceCharge),
    netSales,
    salesInsights: parsed.salesInsights,
  };
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
  return name ? sites.find((site) => name.includes(normaliseSiteName(site.name)) || name.includes(normaliseSiteName(site.code))) ?? null : null;
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

function hourlyMetricsForFile(siteId: string, fileName: string, sha256: string, parsed: ParsedPackFile): HourlyMetric[] {
  const values = parsed.summary.hourlyLabour;
  if (!Array.isArray(values)) return [];
  const sourceReference = `${fileName}:${sha256.slice(0, 16)}`.slice(0, 250);
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const businessDate = typeof row.businessDate === "string" ? row.businessDate : "";
    const slotTime = typeof row.slotTime === "string" ? row.slotTime : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !/^\d{2}:\d{2}:\d{2}$/.test(slotTime)) return [];
    return [{
      siteId,
      businessDate,
      slotTime,
      staffedHours: Math.max(numeric(row.staffedHours) ?? 0, 0),
      staffCount: Math.max(numeric(row.staffCount) ?? 0, 0),
      hourlyCost: Math.max(numeric(row.hourlyCost) ?? 0, 0),
      sourceReference,
    }];
  });
}

async function replaceGroupHourlyLabour({
  admin,
  organisationId,
  weekStart,
  weekEnd,
  siteIds,
  rows,
}: {
  admin: ReturnType<typeof createAdminClient>;
  organisationId: string;
  weekStart: string;
  weekEnd: string;
  siteIds: string[];
  rows: HourlyMetric[];
}) {
  for (const siteId of siteIds) {
    const { error } = await admin
      .from("hourly_labour_metrics")
      .delete()
      .eq("organisation_id", organisationId)
      .eq("site_id", siteId)
      .eq("source_system", "rotacloud_group_pack")
      .gte("business_date", weekStart)
      .lte("business_date", weekEnd);
    if (error) return "The previous group RotaCloud hourly data could not be refreshed.";
  }
  if (!rows.length) return null;

  const deduped = new Map<string, HourlyMetric>();
  for (const row of rows) deduped.set(`${row.siteId}:${row.businessDate}:${row.slotTime}`, row);
  const payload = [...deduped.values()].map((row) => ({
    organisation_id: organisationId,
    site_id: row.siteId,
    business_date: row.businessDate,
    slot_time: row.slotTime,
    interval_minutes: 60,
    staffed_hours: row.staffedHours,
    staff_count: row.staffCount,
    hourly_cost: row.hourlyCost,
    source_system: "rotacloud_group_pack",
    source_reference: row.sourceReference,
    imported_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("hourly_labour_metrics").upsert(payload, {
    onConflict: "organisation_id,site_id,business_date,slot_time,interval_minutes,source_system",
  });
  return error ? "The detailed group RotaCloud labour data could not be stored." : null;
}

async function markBatchError(admin: ReturnType<typeof createAdminClient>, batchId: string) {
  await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batchId);
}

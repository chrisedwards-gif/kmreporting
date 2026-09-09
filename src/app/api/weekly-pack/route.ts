import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionProfile } from "@/lib/auth/dal";
import { classifyWeeklyPackFile, packSiteMatches, type ParsedPackFile } from "@/lib/reporting/pack-parser";
import { isSundayToSaturday } from "@/lib/reporting/periods";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxFiles = 20;
const maxFileBytes = 25 * 1024 * 1024;
const maxBatchBytes = 120 * 1024 * 1024;

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

export async function POST(request: NextRequest) {
  const profile = await requireSessionProfile();
  if (!profile.capabilities.editReports) return NextResponse.json({ error: "You do not have permission to create weekly reports." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });

  const siteId = String(form.get("siteId") ?? "");
  const weekStart = String(form.get("weekStart") ?? "");
  const weekEnd = saturdayAfter(weekStart);
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!siteId || !weekStart || !weekEnd || !isSundayToSaturday(weekStart, weekEnd)) {
    return NextResponse.json({ error: "Choose a valid Sunday-to-Saturday reporting week." }, { status: 400 });
  }
  if (profile.siteScopeIds && !profile.siteScopeIds.includes(siteId)) {
    return NextResponse.json({ error: "That kitchen is outside your reporting access." }, { status: 403 });
  }
  if (!files.length) return NextResponse.json({ error: "Drop at least one weekly source file." }, { status: 400 });
  if (files.length > maxFiles) return NextResponse.json({ error: `Upload no more than ${maxFiles} files at once.` }, { status: 400 });
  if (files.some((file) => file.size > maxFileBytes)) return NextResponse.json({ error: "One of the files is larger than 25 MB." }, { status: 413 });
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBatchBytes) return NextResponse.json({ error: "The full upload is larger than 120 MB." }, { status: 413 });

  const admin = createAdminClient();
  const { data: site, error: siteError } = await admin
    .from("sites")
    .select("id, name, organisation_id, active")
    .eq("id", siteId)
    .eq("organisation_id", profile.organisationId)
    .eq("active", true)
    .maybeSingle();
  if (siteError || !site) return NextResponse.json({ error: "That kitchen is unavailable." }, { status: 404 });

  const { data: batch, error: batchError } = await admin
    .from("weekly_upload_batches")
    .insert({
      organisation_id: profile.organisationId,
      site_id: siteId,
      week_start: weekStart,
      week_end: weekEnd,
      batch_kind: "site",
      status: "processing",
      uploaded_by: profile.id,
    })
    .select("id")
    .single();
  if (batchError || !batch) return NextResponse.json({ error: "The weekly upload batch could not be created." }, { status: 500 });

  const expected = { start: weekStart, end: weekEnd };
  const parsedFiles: Array<{ file: File; parsed: ParsedPackFile; sha256: string; storagePath: string; fileId: string }> = [];
  let fatalStorageError = "";

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileId = randomUUID();
    const storagePath = `${profile.organisationId}/${weekStart}/${siteId}/${batch.id}/${fileId}-${safeFileName(file.name)}`;
    const contentType = file.type || "application/octet-stream";
    const { error: storageError } = await admin.storage
      .from("weekly-report-packs")
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (storageError) {
      fatalStorageError = `Could not retain ${file.name} privately.`;
      break;
    }

    const content = decodeReportText(bytes);
    let parsed = classifyWeeklyPackFile(file.name, content, expected);
    if (parsed.parseStatus === "parsed" && !packSiteMatches(parsed.siteHint, site.name)) {
      parsed = { ...parsed, parseStatus: "error", error: `This file appears to be for ${parsed.siteHint}, not ${site.name}.` };
    }

    const { error: fileRowError } = await admin.from("weekly_upload_files").insert({
      id: fileId,
      batch_id: batch.id,
      file_name: file.name,
      storage_path: storagePath,
      content_type: contentType,
      byte_size: file.size,
      sha256,
      classification: parsed.classification,
      parse_status: parsed.parseStatus,
      site_hint: parsed.siteHint,
      period_start: parsed.periodStart,
      period_end: parsed.periodEnd,
      parsed_summary: parsed.summary,
      parse_error: parsed.error,
    });
    if (fileRowError) {
      fatalStorageError = `Could not register ${file.name} in the reporting audit trail.`;
      break;
    }
    parsedFiles.push({ file, parsed, sha256, storagePath, fileId });
  }

  if (fatalStorageError) {
    await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
    return NextResponse.json({ error: fatalStorageError, batchId: batch.id }, { status: 500 });
  }

  const successful = parsedFiles.filter((entry) => entry.parsed.parseStatus === "parsed");
  const sales = successful.find((entry) => entry.parsed.classification === "sales_eow");
  const goods = successful.find((entry) => entry.parsed.classification === "procure_goods");
  const credits = successful.find((entry) => entry.parsed.classification === "procure_credits");
  const labour = successful.find((entry) => entry.parsed.classification === "rotacloud_labour");

  const salesSummary = sales?.parsed.summary ?? {};
  const goodsSummary = goods?.parsed.summary ?? {};
  const creditsSummary = credits?.parsed.summary ?? {};
  const labourSummary = labour?.parsed.summary ?? {};
  const sourceRef = (entry: typeof sales | undefined) => entry ? `${entry.file.name}:${entry.sha256.slice(0, 16)}` : "";

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
    return NextResponse.json({ error: "Your session could not save the weekly draft." }, { status: 401 });
  }

  const payload = {
    siteId,
    weekStart,
    weekEnd,
    netSales: Number(salesSummary.netSales ?? 0),
    openingStock: 0,
    purchases: Number(goodsSummary.purchases ?? 0),
    credits: Number(creditsSummary.confirmedCredits ?? 0),
    transfersIn: 0,
    transfersOut: 0,
    closingStock: 0,
    adjustments: 0,
    wasteCost: 0,
    staffCost: Number(labourSummary.staffCost ?? 0),
    paidHours: Number(labourSummary.paidHours ?? 0),
    pendingCredits: Number(creditsSummary.pendingCredits ?? 0),
    awaitingInvoice: Number(goodsSummary.awaitingInvoice ?? 0),
    stocktakeCompleted: false,
    salesSource: sales ? "weekly_pack_upload" : "manual",
    purchasingSource: goods ? "weekly_pack_upload" : "manual",
    labourSource: labour ? "weekly_pack_upload" : "manual",
    salesSourceReference: sourceRef(sales),
    purchasingSourceReference: [sourceRef(goods), sourceRef(credits)].filter(Boolean).join(" | ").slice(0, 250),
    labourSourceReference: sourceRef(labour),
    salesConfirmed: Boolean(sales),
    purchasingConfirmed: Boolean(goods),
    labourConfirmed: Boolean(labour),
    manualPurchases: [],
    ...(sales?.parsed.salesInsights ? { salesInsights: sales.parsed.salesInsights } : {}),
    wins: "",
    operationalIssues: "",
    staffingIssues: "",
    complianceIssues: "",
    equipmentIssues: "",
    actionsUnderway: "",
    supportNeeded: "",
    submittedBy: profile.id,
    status: "draft",
  };

  const { data: reportId, error: reportError } = await supabase.rpc("save_weekly_report_v2", { payload });
  if (reportError || typeof reportId !== "string") {
    await admin.from("weekly_upload_batches").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", batch.id);
    return NextResponse.json({ error: reportError?.message ?? "The weekly draft could not be created.", batchId: batch.id }, { status: 409 });
  }

  await admin.from("weekly_upload_batches").update({ report_id: reportId, status: "ready", updated_at: new Date().toISOString() }).eq("id", batch.id);
  await admin.from("audit_log").insert({
    organisation_id: profile.organisationId,
    actor_id: profile.id,
    action: "weekly_pack.uploaded",
    entity_type: "weekly_report",
    entity_id: reportId,
    detail: {
      batch_id: batch.id,
      file_count: parsedFiles.length,
      parsed_count: successful.length,
      site_id: siteId,
      week_start: weekStart,
      classifications: parsedFiles.map((entry) => entry.parsed.classification),
    },
  });

  const missing = [
    !sales ? "EPOS sales" : null,
    !goods ? "Goods Delivered" : null,
    !labour ? "labour" : null,
  ].filter((item): item is string => Boolean(item));

  return NextResponse.json({
    ok: true,
    reportId,
    batchId: batch.id,
    siteName: site.name,
    missing,
    parsed: parsedFiles.map((entry) => ({
      name: entry.file.name,
      classification: entry.parsed.classification,
      status: entry.parsed.parseStatus,
      error: entry.parsed.error,
      summary: entry.parsed.summary,
    })),
  });
}

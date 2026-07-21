import "server-only";

import { buildManagementPackPdf } from "@/lib/pdf/management-pack";
import { sendTransactionalEmail } from "@/lib/notifications/email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ManualPurchase, ReportStatus, ReviewFlag, SitePerformance, WeeklyReport } from "@/lib/types";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export type ManagementDeliveryBundle = {
  week: { id: string; start: string; end: string; dueAt: string };
  reports: WeeklyReport[];
  expectedSites: Array<{ id: string; name: string; code: string }>;
};

export type ManagementEmailDeliveryResult = {
  ok: boolean;
  skipped: boolean;
  message: string;
  providerReference?: string;
  partial?: boolean;
};

type DeliveryInput = {
  organisationId: string;
  recipientName: string;
  recipientEmail: string;
  periodId?: string;
  allowPartial: boolean;
  deliveryKind: "scheduled" | "manual" | "test";
  actorId?: string;
};

type DbReport = {
  id: string;
  site_id: string;
  manager_id: string;
  status: ReportStatus;
  wins: string;
  operational_issues: string;
  staffing_issues: string;
  compliance_issues: string;
  equipment_issues: string;
  actions_underway: string;
  support_needed: string;
  submitted_at: string | null;
  updated_at: string;
};

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const usefulText = (value: string | undefined, fallback: string) => {
  const text = value?.trim() ?? "";
  return !text || /^(?:n\/?a|none|nil|-+)$/i.test(text) ? fallback : text;
};

const optionalCost = (value: number | undefined) => value ?? 0;

export async function loadManagementDeliveryBundle(
  organisationId: string,
  periodId?: string,
): Promise<ManagementDeliveryBundle | null> {
  const admin = createAdminClient();
  let periodQuery = admin
    .from("reporting_periods")
    .select("id, week_start, week_end, due_at")
    .eq("organisation_id", organisationId)
    .eq("reporting_cycle", "sunday_saturday");
  periodQuery = periodId
    ? periodQuery.eq("id", periodId)
    : periodQuery.lte("week_end", new Date().toISOString().slice(0, 10)).order("week_end", { ascending: false }).limit(1);
  const { data: period } = await periodQuery.maybeSingle();
  if (!period) return null;

  const [{ data: expectedSites = [] }, { data: rawReports, error: reportError }] = await Promise.all([
    admin.from("sites").select("id, name, code")
      .eq("organisation_id", organisationId)
      .lte("reporting_start_date", period.week_end)
      .or(`reporting_end_date.is.null,reporting_end_date.gte.${period.week_start}`)
      .order("name"),
    admin.from("weekly_reports")
      .select("id, site_id, manager_id, status, wins, operational_issues, staffing_issues, compliance_issues, equipment_issues, actions_underway, support_needed, submitted_at, updated_at")
      .eq("organisation_id", organisationId)
      .eq("period_id", period.id),
  ]);
  if (reportError) throw new Error("Unable to load weekly reports for delivery.");

  const reports = (rawReports ?? []) as DbReport[];
  const reportIds = reports.map((report) => report.id);
  const siteIds = [...new Set(reports.map((report) => report.site_id))];
  const managerIds = [...new Set(reports.map((report) => report.manager_id))];
  const [{ data: rawSites }, { data: rawProfiles }, { data: rawSnapshots }, { data: rawSources }, { data: rawPurchases }] = await Promise.all([
    siteIds.length ? admin.from("sites").select("id, code, name, food_cost_target, labour_target, waste_target").in("id", siteIds) : Promise.resolve({ data: [] }),
    managerIds.length ? admin.from("profiles").select("id, full_name").in("id", managerIds) : Promise.resolve({ data: [] }),
    reportIds.length ? admin.from("site_cost_snapshots").select("report_id, site_id, net_sales, cogs, food_cost_pct, staff_cost, hourly_staff_cost, salary_staff_cost, salary_oncost_cost, salaries_included, labour_pct, waste_cost, waste_pct, prime_cost, prime_cost_pct, food_cost_basis, review_flags").in("report_id", reportIds) : Promise.resolve({ data: [] }),
    reportIds.length ? admin.from("report_source_values").select("report_id, sales_source, purchasing_source, labour_source, sales_source_reference, purchasing_source_reference, labour_source_reference, pending_credits, awaiting_invoice, stocktake_completed").in("report_id", reportIds) : Promise.resolve({ data: [] }),
    reportIds.length ? admin.from("report_manual_purchases").select("report_id, description, amount, receipt_reference").in("report_id", reportIds).order("created_at") : Promise.resolve({ data: [] }),
  ]);

  const sitesById = new Map((rawSites ?? []).map((site) => [site.id, site]));
  const managersById = new Map((rawProfiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const snapshotsByReport = new Map((rawSnapshots ?? []).map((snapshot) => [snapshot.report_id, snapshot]));
  const sourcesByReport = new Map((rawSources ?? []).map((source) => [source.report_id, source]));
  const purchasesByReport = new Map<string, ManualPurchase[]>();
  for (const purchase of rawPurchases ?? []) {
    const items = purchasesByReport.get(purchase.report_id) ?? [];
    items.push({ description: purchase.description, amount: Number(purchase.amount), receiptReference: purchase.receipt_reference ?? "" });
    purchasesByReport.set(purchase.report_id, items);
  }

  const weeklyReports = reports.flatMap((report): WeeklyReport[] => {
    const site = sitesById.get(report.site_id);
    const snapshot = snapshotsByReport.get(report.id);
    if (!site || !snapshot) return [];
    const costs: SitePerformance = {
      reportId: report.id,
      id: report.site_id,
      code: site.code,
      name: site.name,
      manager: managersById.get(report.manager_id) ?? "Unassigned",
      netSales: Number(snapshot.net_sales ?? 0),
      cogs: Number(snapshot.cogs ?? 0),
      foodCostPct: Number(snapshot.food_cost_pct ?? 0),
      staffCost: Number(snapshot.staff_cost ?? 0),
      hourlyStaffCost: Number(snapshot.hourly_staff_cost ?? snapshot.staff_cost ?? 0),
      salaryStaffCost: Number(snapshot.salary_staff_cost ?? 0),
      salaryOncostCost: Number(snapshot.salary_oncost_cost ?? 0),
      salariesIncluded: Boolean(snapshot.salaries_included),
      labourPct: Number(snapshot.labour_pct ?? 0),
      wasteCost: Number(snapshot.waste_cost ?? 0),
      wastePct: Number(snapshot.waste_pct ?? 0),
      primeCost: Number(snapshot.prime_cost ?? 0),
      primeCostPct: Number(snapshot.prime_cost_pct ?? 0),
      foodCostBasis: snapshot.food_cost_basis === "stock_adjusted" ? "stock_adjusted" : "spend",
      foodCostTarget: Number(site.food_cost_target ?? 0),
      labourTarget: Number(site.labour_target ?? 0),
      wasteTarget: Number(site.waste_target ?? 0),
      status: report.status,
      flags: ((snapshot.review_flags ?? []) as ReviewFlag[]).map((flag) => ({ ...flag, detail: flag.detail ?? "Review required." })),
    };
    const source = sourcesByReport.get(report.id);
    return [{
      id: report.id,
      siteId: report.site_id,
      siteName: site.name,
      manager: managersById.get(report.manager_id) ?? "Unassigned",
      weekStart: period.week_start,
      weekEnd: period.week_end,
      status: report.status,
      updatedAt: report.updated_at,
      submittedAt: report.submitted_at ?? undefined,
      wins: report.wins,
      operationalIssues: report.operational_issues,
      staffingIssues: report.staffing_issues,
      complianceIssues: report.compliance_issues,
      equipmentIssues: report.equipment_issues,
      actionsUnderway: report.actions_underway,
      supportNeeded: report.support_needed,
      manualPurchases: purchasesByReport.get(report.id) ?? [],
      costs,
      sources: source ? {
        sales: source.sales_source,
        purchasing: source.purchasing_source,
        labour: source.labour_source,
        salesReference: source.sales_source_reference || undefined,
        purchasingReference: source.purchasing_source_reference || undefined,
        labourReference: source.labour_source_reference || undefined,
        pendingCredits: Number(source.pending_credits ?? 0),
        awaitingInvoice: Number(source.awaiting_invoice ?? 0),
        stocktakeCompleted: Boolean(source.stocktake_completed),
      } : undefined,
    }];
  });

  return {
    week: { id: period.id, start: period.week_start, end: period.week_end, dueAt: period.due_at },
    reports: weeklyReports,
    expectedSites: expectedSites ?? [],
  };
}

export function buildManagementEmail(bundle: ManagementDeliveryBundle, recipientName: string) {
  const approved = bundle.reports.filter((report) => ["approved", "shared"].includes(report.status));
  const reportBySite = new Map(bundle.reports.map((report) => [report.siteId, report]));
  const outstanding = bundle.expectedSites.filter((site) => !["approved", "shared"].includes(reportBySite.get(site.id)?.status ?? "draft"));
  const partial = outstanding.length > 0;
  const totals = approved.reduce((sum, report) => ({
    sales: sum.sales + report.costs.netSales,
    food: sum.food + report.costs.cogs,
    labour: sum.labour + report.costs.staffCost,
    hourly: sum.hourly + optionalCost(report.costs.hourlyStaffCost),
    salary: sum.salary + optionalCost(report.costs.salaryStaffCost),
    oncost: sum.oncost + optionalCost(report.costs.salaryOncostCost),
    waste: sum.waste + optionalCost(report.costs.wasteCost),
    pendingCredits: sum.pendingCredits + (report.sources?.pendingCredits ?? 0),
  }), { sales: 0, food: 0, labour: 0, hourly: 0, salary: 0, oncost: 0, waste: 0, pendingCredits: 0 });
  const foodPct = totals.sales ? totals.food / totals.sales * 100 : 0;
  const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;
  const wastePct = totals.sales ? totals.waste / totals.sales * 100 : 0;
  const weightedFoodTarget = totals.sales ? approved.reduce((sum, report) => sum + report.costs.foodCostTarget * report.costs.netSales, 0) / totals.sales : 0;
  const weightedLabourTarget = totals.sales ? approved.reduce((sum, report) => sum + report.costs.labourTarget * report.costs.netSales, 0) / totals.sales : 0;
  const strongest = [...approved].sort((a, b) => b.costs.netSales - a.costs.netSales)[0];
  const foodConcern = [...approved].sort((a, b) => (b.costs.foodCostPct - b.costs.foodCostTarget) - (a.costs.foodCostPct - a.costs.foodCostTarget))[0];
  const labourConcern = [...approved].sort((a, b) => (b.costs.labourPct - b.costs.labourTarget) - (a.costs.labourPct - a.costs.labourTarget))[0];
  const risks = approved.flatMap((report) => {
    const issues = [report.operationalIssues, report.staffingIssues, report.complianceIssues, report.equipmentIssues]
      .map((value) => value.trim())
      .filter((value) => value && !/^(?:n\/?a|none|nil|-+)$/i.test(value));
    return issues.length ? [`${report.siteName}: ${issues.join(" ")}`] : [];
  });

  const subject = `${partial ? "PARTIAL – " : ""}HOS Weekly Management Pack | Week ending ${formatDate(bundle.week.end)}`;
  const intro = `Attached is the weekly management pack for ${formatDate(bundle.week.start)} to ${formatDate(bundle.week.end)}.`;
  const summaryLines = [
    `Reporting coverage: ${approved.length} of ${bundle.expectedSites.length} kitchens approved${partial ? `; outstanding: ${outstanding.map((site) => site.name).join(", ")}` : "; all expected kitchens complete"}.`,
    `Net sales: ${formatCurrency(totals.sales)} across the approved kitchens.`,
    `Food ${approved.every((report) => report.costs.foodCostBasis === "stock_adjusted") ? "cost" : "cost/spend"}: ${formatCurrency(totals.food)} (${formatPercentage(foodPct)}) against a weighted ${formatPercentage(weightedFoodTarget)} target.`,
    `Labour: ${formatCurrency(totals.labour)} (${formatPercentage(labourPct)}) against a weighted ${formatPercentage(weightedLabourTarget)} target.${totals.salary + totals.oncost > 0 ? ` This includes ${formatCurrency(totals.salary)} salary allocation and ${formatCurrency(totals.oncost)} employer on-cost, in addition to ${formatCurrency(totals.hourly)} hourly/rota labour.` : " Salary allocations were not included in these approved reports."}`,
    `Recorded waste: ${formatCurrency(totals.waste)} (${formatPercentage(wastePct)} of net sales).`,
    totals.pendingCredits > 0 ? `Pending supplier credits not yet reducing spend: ${formatCurrency(totals.pendingCredits)}.` : "No pending supplier credit value was recorded.",
  ];
  const managementReadout = [
    strongest ? `Highest sales: ${strongest.siteName} at ${formatCurrency(strongest.costs.netSales)}.` : "",
    foodConcern && foodConcern.costs.foodCostPct > foodConcern.costs.foodCostTarget ? `${foodConcern.siteName} has the largest food variance at ${formatPercentage(foodConcern.costs.foodCostPct)} versus ${formatPercentage(foodConcern.costs.foodCostTarget)} target.` : "No approved kitchen is over its food target.",
    labourConcern && labourConcern.costs.labourPct > labourConcern.costs.labourTarget ? `${labourConcern.siteName} has the largest labour variance at ${formatPercentage(labourConcern.costs.labourPct)} versus ${formatPercentage(labourConcern.costs.labourTarget)} target.` : "No approved kitchen is over its labour target.",
    risks.length ? `Operational attention: ${risks.slice(0, 4).join(" | ")}` : "No material operational, staffing, compliance or equipment issue was recorded.",
  ].filter(Boolean);
  const siteLines = approved.map((report) => [
    `${report.siteName}: ${formatCurrency(report.costs.netSales)} sales · ${formatPercentage(report.costs.foodCostPct)} food · ${formatPercentage(report.costs.labourPct)} labour · ${formatPercentage(report.costs.wastePct)} waste.`,
    `Win: ${usefulText(report.wins, "No material win recorded.")}`,
    `Action: ${usefulText(report.actionsUnderway, "No follow-up action recorded.")}`,
    report.supportNeeded.trim() ? `Support requested: ${report.supportNeeded.trim()}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
  const text = [
    `Hi ${recipientName.split(" ")[0] || recipientName},`,
    intro,
    summaryLines.join("\n"),
    `Management readout:\n${managementReadout.map((line) => `• ${line}`).join("\n")}`,
    siteLines,
    "The attached A4 pack contains the full group scorecard, controls and kitchen-by-kitchen detail.",
    "Thanks,\nChris",
  ].join("\n\n");

  const metric = (label: string, value: string, note: string) => `<td style="width:25%;padding:6px"><div style="border:1px solid #d8ddd9;border-radius:12px;padding:13px;background:#fff"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#617069">${escapeHtml(label)}</div><div style="font-size:22px;font-weight:700;margin:6px 0;color:#10271f">${escapeHtml(value)}</div><div style="font-size:11px;color:#617069">${escapeHtml(note)}</div></div></td>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#17352d;background:#f5f6f2;padding:24px">
    <div style="background:#10271f;color:#fff;border-radius:16px;padding:24px;margin-bottom:18px"><div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8fd0b7">HOS Kitchen Reports</div><h1 style="font-size:28px;margin:8px 0">${escapeHtml(subject)}</h1><p style="margin:0;color:#d1dfd8">${escapeHtml(intro)}</p></div>
    ${partial ? `<div style="background:#fff2d5;border:1px solid #e5c16e;border-radius:12px;padding:14px;margin-bottom:18px"><strong>Partial reporting pack:</strong> ${escapeHtml(outstanding.map((site) => site.name).join(", "))} ${outstanding.length === 1 ? "is" : "are"} still outstanding.</div>` : ""}
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 -6px 18px"><tr>${metric("Net sales", formatCurrency(totals.sales), `${approved.length} approved kitchens`)}${metric("Food", formatPercentage(foodPct), `Target ${formatPercentage(weightedFoodTarget)}`)}${metric("Labour", formatPercentage(labourPct), `Target ${formatPercentage(weightedLabourTarget)}`)}${metric("Waste", formatPercentage(wastePct), formatCurrency(totals.waste))}</tr></table>
    <div style="background:#fff;border:1px solid #d8ddd9;border-radius:14px;padding:20px;margin-bottom:18px"><h2 style="font-size:18px;margin:0 0 12px">Management readout</h2><ul style="padding-left:20px;line-height:1.6;margin:0">${managementReadout.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></div>
    ${approved.map((report) => `<div style="background:#fff;border:1px solid #d8ddd9;border-radius:14px;padding:18px;margin-bottom:12px"><h2 style="font-size:17px;margin:0 0 8px">${escapeHtml(report.siteName)}</h2><p style="margin:0 0 8px"><strong>${escapeHtml(formatCurrency(report.costs.netSales))}</strong> sales · ${escapeHtml(formatPercentage(report.costs.foodCostPct))} food · ${escapeHtml(formatPercentage(report.costs.labourPct))} labour · ${escapeHtml(formatPercentage(report.costs.wastePct))} waste</p><p style="margin:0 0 6px"><strong>Win:</strong> ${escapeHtml(usefulText(report.wins, "No material win recorded."))}</p><p style="margin:0"><strong>Action:</strong> ${escapeHtml(usefulText(report.actionsUnderway, "No follow-up action recorded."))}</p></div>`).join("")}
    <p style="font-size:12px;color:#617069;margin-top:20px">The full A4 management pack is attached as a PDF.</p>
  </div>`;
  return { subject, text, html, partial, approvedCount: approved.length, outstanding };
}

export async function deliverManagementPackEmail(input: DeliveryInput): Promise<ManagementEmailDeliveryResult> {
  const bundle = await loadManagementDeliveryBundle(input.organisationId, input.periodId);
  if (!bundle) return { ok: false, skipped: true, message: "No completed reporting period is available." };
  const content = buildManagementEmail(bundle, input.recipientName);
  if (!content.approvedCount) return { ok: false, skipped: true, message: "No approved kitchen report is available to send." };
  if (content.partial && !input.allowPartial) return { ok: false, skipped: true, partial: true, message: "The weekly pack is incomplete and partial delivery is disabled." };

  const admin = createAdminClient();
  let auditActorId = input.actorId;
  if (!auditActorId) {
    const { data: actor } = await admin.from("profiles").select("id")
      .eq("organisation_id", input.organisationId)
      .eq("active", true)
      .in("role", ["admin", "group_manager"])
      .order("role")
      .limit(1)
      .maybeSingle();
    auditActorId = actor?.id;
  }
  if (!auditActorId) return { ok: false, skipped: false, message: "No active management profile is available to own the delivery audit record." };

  const fixedDedupe = `management-pack:${input.organisationId}:${bundle.week.id}:${input.recipientEmail.toLowerCase()}`;
  const dedupeKey = input.deliveryKind === "scheduled" ? fixedDedupe : `${fixedDedupe}:${input.deliveryKind}:${crypto.randomUUID()}`;
  if (input.deliveryKind === "scheduled") {
    const { data: existing } = await admin.from("notification_log").select("id, delivery_status").eq("dedupe_key", dedupeKey).maybeSingle();
    if (existing?.delivery_status === "sent") return { ok: true, skipped: true, partial: content.partial, message: "This reporting period has already been emailed." };
  }

  const pdf = buildManagementPackPdf({ week: bundle.week, reports: bundle.reports, expectedSites: bundle.expectedSites, preparedFor: input.recipientName });
  const { data: log, error: logError } = await admin.from("notification_log").insert({
    organisation_id: input.organisationId,
    recipient_id: auditActorId,
    notification_type: input.deliveryKind === "scheduled" ? "scheduled_management_summary" : input.deliveryKind === "test" ? "test_management_summary" : "management_summary",
    dedupe_key: dedupeKey,
    delivery_status: "queued",
    recipient_email: input.recipientEmail,
    subject: content.subject,
    message: content.text,
    action_path: `/summary?period=${bundle.week.id}`,
  }).select("id").single();
  if (logError || !log) return { ok: false, skipped: false, message: "The management email could not be queued." };

  const delivery = await sendTransactionalEmail({
    to: input.recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{ filename: `HOS-Weekly-Management-Pack-${bundle.week.end}.pdf`, content: pdf, contentType: "application/pdf" }],
    idempotencyKey: `management-pack-${log.id}`,
    category: input.deliveryKind === "scheduled" ? "scheduled_management_summary" : "management_summary",
  });
  await admin.from("notification_log").update({
    delivery_status: delivery.configured && delivery.ok ? "sent" : "failed",
    provider_reference: delivery.providerReference || null,
    error_message: delivery.ok ? null : delivery.error,
    sent_at: delivery.ok ? new Date().toISOString() : null,
  }).eq("id", log.id);

  if (delivery.ok && input.deliveryKind !== "test") {
    await admin.from("management_email_settings").update({ last_sent_period_id: bundle.week.id, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organisation_id", input.organisationId);
  }
  if (!delivery.configured) return { ok: false, skipped: false, partial: content.partial, message: "Resend is not configured on this deployment." };
  if (!delivery.ok) return { ok: false, skipped: false, partial: content.partial, message: delivery.error };
  return { ok: true, skipped: false, partial: content.partial, providerReference: delivery.providerReference, message: `Management pack emailed to ${input.recipientEmail}.` };
}

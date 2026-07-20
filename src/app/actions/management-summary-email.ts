"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { getReportingBundle } from "@/lib/data/reporting";
import { sendTransactionalEmail } from "@/lib/notifications/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export type SummaryEmailState = { status: "idle" | "success" | "error"; message: string };

const schema = z.object({ periodId: z.uuid() });

const usefulAttention = (report: Awaited<ReturnType<typeof getReportingBundle>>["reports"][number]) =>
  report.operationalIssues || report.staffingIssues || report.complianceIssues || report.equipmentIssues || "No material issue recorded.";

export async function sendManagementSummaryTestEmail(
  _previous: SummaryEmailState,
  formData: FormData,
): Promise<SummaryEmailState> {
  const actor = await requireActualRole(["admin", "group_manager"]);
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a valid reporting week." };

  try {
    const admin = createAdminClient();
    const [{ data: recipient, error: recipientError }, bundle] = await Promise.all([
      admin.from("profiles").select("id, full_name, notification_email").eq("id", actor.id).single(),
      getReportingBundle(parsed.data.periodId),
    ]);

    if (recipientError || !recipient?.notification_email) {
      return { status: "error", message: "Add your notification email in People & access before sending a test." };
    }

    const approvedReports = bundle.reports.filter((report) => ["approved", "shared"].includes(report.status));
    if (!approvedReports.length) {
      return { status: "error", message: "Approve at least one kitchen report before testing the management email." };
    }

    const reportBySite = new Map(bundle.reports.map((report) => [report.siteId, report]));
    const outstanding = bundle.expectedSites.filter((site) => !["approved", "shared"].includes(reportBySite.get(site.id)?.status ?? "draft"));
    const totals = approvedReports.reduce((sum, report) => ({
      sales: sum.sales + report.costs.netSales,
      food: sum.food + report.costs.cogs,
      labour: sum.labour + report.costs.staffCost,
    }), { sales: 0, food: 0, labour: 0 });
    const foodPct = totals.sales ? totals.food / totals.sales * 100 : 0;
    const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;

    const kitchenSections = approvedReports.map((report) => [
      `${report.siteName} (${report.costs.code})`,
      `Performance: ${formatCurrency(report.costs.netSales)} net sales · ${formatPercentage(report.costs.foodCostPct)} ${report.costs.foodCostBasis === "stock_adjusted" ? "food cost" : "food spend"} · ${formatPercentage(report.costs.labourPct)} labour.`,
      `Win: ${report.wins || "No material win recorded."}`,
      `Attention: ${usefulAttention(report)}`,
      `Action: ${report.actionsUnderway || "No follow-up action recorded."}`,
      report.supportNeeded ? `Group support: ${report.supportNeeded}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");

    const subject = `TEST – HOS Weekly Management Overview | Week ending ${formatDate(bundle.week.end)}`;
    const text = [
      `Hi ${recipient.full_name?.split(" ")[0] ?? "Chris"},`,
      "This is a live delivery and formatting test. It has been sent only to your own account and has not been sent to Jake.",
      `Reporting status: ${outstanding.length ? "PARTIAL" : "COMPLETE"} · ${approvedReports.length} of ${bundle.expectedSites.length} kitchens approved.`,
      `Group totals: ${formatCurrency(totals.sales)} net sales · ${formatPercentage(foodPct)} food cost/spend · ${formatPercentage(labourPct)} labour · ${formatPercentage(foodPct + labourPct)} prime cost.`,
      outstanding.length ? `Outstanding: ${outstanding.map((site) => site.name).join(", ")}.` : "All expected kitchens are approved.",
      kitchenSections,
      "Once the layout and figures are approved, a separate reporting-viewer account and live recipient can be configured for Jake.",
    ].join("\n\n");

    const { data: logged, error: logError } = await admin.from("notification_log").insert({
      organisation_id: actor.organisationId,
      recipient_id: actor.id,
      notification_type: "test_management_summary",
      dedupe_key: `summary-test:${actor.id}:${parsed.data.periodId}:${crypto.randomUUID()}`,
      delivery_status: "queued",
      recipient_email: recipient.notification_email,
      subject,
      message: text,
      action_path: `/summary?period=${parsed.data.periodId}`,
    }).select("id").single();
    if (logError || !logged) return { status: "error", message: "The management-summary test could not be queued." };

    const delivery = await sendTransactionalEmail({
      to: recipient.notification_email,
      subject,
      text,
      idempotencyKey: `management-summary-test-${logged.id}`,
      category: "management_summary_test",
    });

    await admin.from("notification_log").update({
      delivery_status: delivery.configured && delivery.ok ? "sent" : "failed",
      provider_reference: delivery.providerReference || null,
      error_message: delivery.ok ? null : delivery.error,
      sent_at: delivery.ok ? new Date().toISOString() : null,
    }).eq("id", logged.id);

    revalidatePath("/summary");
    revalidatePath("/notifications");

    if (!delivery.configured) return { status: "error", message: "Resend is not configured on this deployment, so no test email was sent." };
    if (!delivery.ok) return { status: "error", message: `Email delivery failed: ${delivery.error}` };
    return { status: "success", message: `Test email sent to ${recipient.notification_email}.` };
  } catch (error) {
    console.error("management summary email test failed", error);
    return { status: "error", message: "The management-summary test could not be sent. Check the production email configuration." };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireRole } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ApprovalActionState = { status: "idle" | "success" | "error"; message: string; intent?: "complete" | "individual" | "partial" };

const schema = z.object({
  reportId: z.uuid(),
  intent: z.enum(["approve", "changes_requested"]),
  notes: z.string().max(4_000).default(""),
});

export async function processApproval(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Check the decision details and try again." };
  if (parsed.data.intent === "changes_requested" && !parsed.data.notes.trim()) {
    return { status: "error", message: "Explain what the kitchen manager must change before returning the report." };
  }
  await requireRole(["admin", "group_manager"]);

  if (environment.isDemo) {
    return {
      status: "success",
      message: parsed.data.intent === "approve"
        ? "Demo approval validated. In production this records your name, notes and timestamp."
        : "Demo change request validated. In production the report returns to draft with your notes in the audit trail.",
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = parsed.data.intent === "approve"
    ? await supabase.rpc("resolve_and_approve_report", { target_report: parsed.data.reportId, resolution_notes: parsed.data.notes })
    : await supabase.rpc("decide_report", { target_report: parsed.data.reportId, target_decision: "changes_requested", decision_notes: parsed.data.notes });

  if (error) {
    console.error("report decision failed", { code: error.code, message: error.message, reportId: parsed.data.reportId, intent: parsed.data.intent });
    return {
      status: "error",
      message: parsed.data.intent === "approve"
        ? "The report could not be approved. Confirm it is submitted and every actionable review flag has written resolution notes."
        : "The report could not be returned for changes. Confirm it is still awaiting a management decision.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath(`/reports/${parsed.data.reportId}`);
  return {
    status: "success",
    message: parsed.data.intent === "approve" ? "Report approved." : "Changes requested. The report has returned to draft.",
  };
}

const releaseSchema = z.object({ periodId: z.uuid(), intent: z.enum(["complete", "partial"]) });
const individualShareSchema = z.object({ reportId: z.uuid() });

export async function shareApprovedReport(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = individualShareSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The report is unavailable." };
  await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) return { status: "success", intent: "individual", message: "Demo share record validated; no email was sent." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("mark_report_shared", { target_report: parsed.data.reportId, channel: "individual_report" });
  if (error) {
    console.error("individual report share failed", { code: error.code, message: error.message, reportId: parsed.data.reportId });
    return { status: "error", message: "Only an approved kitchen report can be recorded as shared." };
  }
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath(`/reports/${parsed.data.reportId}`);
  return { status: "success", intent: "individual", message: "Share recorded in the audit trail. No email was sent by this action." };
}

export async function releaseManagementSummary(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The reporting period is unavailable." };
  await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) return { status: "success", intent: parsed.data.intent, message: "Demo summary action validated; no email was sent." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: period } = await supabase.from("reporting_periods").select("week_start, week_end").eq("id", parsed.data.periodId).maybeSingle();
  if (!period) return { status: "error", message: "The reporting period is unavailable." };

  if (parsed.data.intent === "partial") {
    const [{ data: reports, error: reportsError }, { count: expectedSiteCount }] = await Promise.all([
      supabase.from("weekly_reports").select("id, status").eq("period_id", parsed.data.periodId),
      supabase.from("sites").select("id", { count: "exact", head: true }).lte("reporting_start_date", period.week_end).or(`reporting_end_date.is.null,reporting_end_date.gte.${period.week_start}`),
    ]);
    if (reportsError || !reports?.some((report) => ["approved", "shared"].includes(report.status))) {
      return { status: "error", message: "At least one approved kitchen report is required for a partial update." };
    }
    const { error } = await supabase.rpc("record_partial_management_summary", { target_period: parsed.data.periodId });
    if (error) {
      console.error("partial management update failed", { code: error.code, message: error.message, periodId: parsed.data.periodId });
      return { status: "error", message: "The partial update could not be recorded. Check the approval queue and try again." };
    }
    revalidatePath("/approvals");
    revalidatePath("/summary");
    return { status: "success", intent: "partial", message: `Partial update recorded in the audit trail; no email was sent. ${Math.max((expectedSiteCount ?? 0) - reports.filter((report) => ["approved", "shared"].includes(report.status)).length, 0)} kitchen report(s) are still awaiting submission or approval.` };
  }

  const { error } = await supabase.rpc("release_management_summary", { target_period: parsed.data.periodId });
  if (error) {
    console.error("complete management release failed", { code: error.code, message: error.message, periodId: parsed.data.periodId });
    return { status: "error", message: "Every required kitchen must have an approved report before the complete summary can be released." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  return { status: "success", intent: "complete", message: "Management summary marked as released in one audited transaction. No email was sent by this action." };
}

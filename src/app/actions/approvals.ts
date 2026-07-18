"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireRole } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ApprovalActionState = { status: "idle" | "success" | "error"; message: string; intent?: "complete" | "individual" | "partial" };

const schema = z.object({
  reportId: z.uuid(),
  intent: z.literal("approve"),
  notes: z.string().max(4_000).default(""),
});

export async function processApproval(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Check the decision details and try again." };
  await requireRole(["admin", "group_manager"]);

  if (environment.isDemo) {
    return {
      status: "success",
      message: parsed.data.intent === "approve"
        ? "Demo decision validated. In production this records your name, notes and timestamp."
        : "Demo share gate passed. In production the approved safe summary would now be released.",
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("resolve_and_approve_report", { target_report: parsed.data.reportId, resolution_notes: parsed.data.notes });
  if (error) return { status: "error", message: "The report could not be approved. Confirm it is submitted and every review flag has written resolution notes." };

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath(`/reports/${parsed.data.reportId}`);
  return { status: "success", message: "Report approved." };
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
  if (environment.isDemo) return { status: "success", intent: "individual", message: "Demo individual share recorded." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("mark_report_shared", { target_report: parsed.data.reportId, channel: "individual_report" });
  if (error) return { status: "error", message: "Only an approved kitchen report can be shared individually." };
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath(`/reports/${parsed.data.reportId}`);
  return { status: "success", intent: "individual", message: "Kitchen report shared and recorded in the audit trail." };
}

export async function releaseManagementSummary(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The reporting period is unavailable." };
  await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) return { status: "success", intent: parsed.data.intent, message: "Demo summary action validated." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: period } = await supabase.from("reporting_periods").select("week_start, week_end").eq("id", parsed.data.periodId).maybeSingle();
  if (!period) return { status: "error", message: "The reporting period is unavailable." };
  const [{ data: reports, error: reportsError }, { count: expectedSiteCount }] = await Promise.all([
    supabase.from("weekly_reports").select("id, status").eq("period_id", parsed.data.periodId),
    supabase.from("sites").select("id", { count: "exact", head: true }).lte("reporting_start_date", period.week_end).or(`reporting_end_date.is.null,reporting_end_date.gte.${period.week_start}`),
  ]);
  if (parsed.data.intent === "partial") {
    if (reportsError || !reports?.some((report) => ["approved", "shared"].includes(report.status))) {
      return { status: "error", message: "At least one approved kitchen report is required for a partial update." };
    }
    const { error } = await supabase.rpc("record_partial_management_summary", { target_period: parsed.data.periodId });
    if (error) return { status: "error", message: "The partial update could not be recorded. Check the approval queue and try again." };
    revalidatePath("/approvals");
    revalidatePath("/summary");
    return { status: "success", intent: "partial", message: `Partial update recorded. ${Math.max((expectedSiteCount ?? 0) - reports.filter((report) => ["approved", "shared"].includes(report.status)).length, 0)} kitchen report(s) are still awaiting submission or approval.` };
  }
  if (reportsError || !reports?.length || reports.length !== expectedSiteCount || reports.some((report) => !["approved", "shared"].includes(report.status))) {
    return { status: "error", message: "Every active kitchen must have an approved report before release." };
  }

  for (const report of reports.filter((item) => item.status === "approved")) {
    const { error } = await supabase.rpc("mark_report_shared", { target_report: report.id, channel: "management_summary" });
    if (error) return { status: "error", message: "Release stopped before completion. Retry safely after checking the approval queue." };
  }
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  return { status: "success", intent: "complete", message: "Management summary released and recorded in the audit trail." };
}

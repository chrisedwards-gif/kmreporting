"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireRole } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ApprovalActionState = { status: "idle" | "success" | "error"; message: string };

const schema = z.object({
  reportId: z.uuid(),
  intent: z.enum(["approve", "share"]),
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
  const { error } = parsed.data.intent === "approve"
    ? await supabase.rpc("resolve_and_approve_report", { target_report: parsed.data.reportId, resolution_notes: parsed.data.notes })
    : await supabase.rpc("mark_report_shared", { target_report: parsed.data.reportId, channel: "management_summary" });
  if (error) return { status: "error", message: parsed.data.intent === "approve" ? "The report could not be approved. Confirm it is submitted and every review flag has written resolution notes." : "Only an approved, unshared report can be released." };

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath(`/reports/${parsed.data.reportId}`);
  return { status: "success", message: parsed.data.intent === "approve" ? "Report approved." : "Approved summary released." };
}

const releaseSchema = z.object({ periodId: z.uuid() });

export async function releaseManagementSummary(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The reporting period is unavailable." };
  await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) return { status: "success", message: "Demo release validated." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: period } = await supabase.from("reporting_periods").select("week_start, week_end").eq("id", parsed.data.periodId).maybeSingle();
  if (!period) return { status: "error", message: "The reporting period is unavailable." };
  const [{ data: reports, error: reportsError }, { count: expectedSiteCount }] = await Promise.all([
    supabase.from("weekly_reports").select("id, status").eq("period_id", parsed.data.periodId),
    supabase.from("sites").select("id", { count: "exact", head: true }).lte("reporting_start_date", period.week_end).or(`reporting_end_date.is.null,reporting_end_date.gte.${period.week_start}`),
  ]);
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
  return { status: "success", message: "Management summary released and recorded in the audit trail." };
}

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
  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  return { status: "success", message: parsed.data.intent === "approve" ? "Report approved." : "Approved summary released." };
}

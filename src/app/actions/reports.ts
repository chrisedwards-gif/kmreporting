"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireSessionProfile } from "@/lib/auth/dal";
import { isMondayToSunday } from "@/lib/reporting/periods";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ReportActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const optionalMoney = z.preprocess((value) => value === "" ? 0 : value, z.coerce.number().finite());
const reportSchema = z.object({
  siteId: z.string().min(1),
  weekStart: z.iso.date(),
  weekEnd: z.iso.date(),
  netSales: optionalMoney.pipe(z.number().nonnegative()),
  openingStock: optionalMoney.pipe(z.number().nonnegative()),
  purchases: optionalMoney.pipe(z.number().nonnegative()),
  credits: optionalMoney.pipe(z.number().nonnegative()),
  transfersIn: optionalMoney.pipe(z.number().nonnegative()),
  transfersOut: optionalMoney.pipe(z.number().nonnegative()),
  closingStock: optionalMoney.pipe(z.number().nonnegative()),
  adjustments: optionalMoney,
  wasteCost: optionalMoney.pipe(z.number().nonnegative()),
  wins: z.string().max(2_000).default(""),
  operationalIssues: z.string().max(2_000).default(""),
  staffingIssues: z.string().max(2_000).default(""),
  complianceIssues: z.string().max(2_000).default(""),
  equipmentIssues: z.string().max(2_000).default(""),
  actionsUnderway: z.string().max(2_000).default(""),
  supportNeeded: z.string().max(2_000).default(""),
  intent: z.enum(["draft", "submit"]),
});

export async function saveWeeklyReport(
  _previousState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the report fields." };
  }
  if (!isMondayToSunday(parsed.data.weekStart, parsed.data.weekEnd)) {
    return { status: "error", message: "The reporting period must run from Monday through Sunday." };
  }
  if (parsed.data.intent === "submit" && parsed.data.netSales <= 0) {
    return { status: "error", message: "Net sales must be entered before the report can be submitted." };
  }

  if (environment.isDemo) {
    return {
      status: "success",
      message: parsed.data.intent === "draft"
        ? "Demo draft validated. Connect Supabase to persist it."
        : "Demo report passed validation and is ready for management review.",
    };
  }

  const profile = await requireSessionProfile();
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { error } = await supabase.rpc("save_weekly_report", {
    payload: {
      ...parsed.data,
      submittedBy: profile.id,
      status: parsed.data.intent === "submit" ? "submitted" : "draft",
    },
  });
  if (error) return { status: "error", message: "The report could not be saved. Check your site access and try again." };

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  return { status: "success", message: parsed.data.intent === "submit" ? "Report submitted for review." : "Draft saved." };
}

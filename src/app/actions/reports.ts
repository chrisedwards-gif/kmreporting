"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireSessionProfile } from "@/lib/auth/dal";
import { isSundayToSaturday } from "@/lib/reporting/periods";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ReportActionState = {
  status: "idle" | "success" | "error";
  message: string;
  intent?: "draft" | "submit";
  reportId?: string;
};

const optionalMoney = z.preprocess((value) => value === "" ? 0 : value, z.coerce.number().finite());
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
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
  staffCost: optionalMoney.pipe(z.number().nonnegative()),
  paidHours: optionalMoney.pipe(z.number().nonnegative()),
  pendingCredits: optionalMoney.pipe(z.number().nonnegative()),
  awaitingInvoice: optionalMoney.pipe(z.number().nonnegative()),
  stocktakeCompleted: booleanString,
  salesSource: z.string().min(1).max(80),
  salesSourceReference: z.string().max(250).default(""),
  salesConfirmed: booleanString,
  purchasingSource: z.string().min(1).max(80),
  purchasingSourceReference: z.string().max(250).default(""),
  purchasingConfirmed: booleanString,
  labourSource: z.string().min(1).max(80),
  labourSourceReference: z.string().max(250).default(""),
  labourConfirmed: booleanString,
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
  if (!isSundayToSaturday(parsed.data.weekStart, parsed.data.weekEnd)) {
    return { status: "error", message: "The reporting period must run from Sunday through Saturday." };
  }
  if (parsed.data.intent === "submit") {
    if (!parsed.data.salesConfirmed || parsed.data.netSales <= 0) {
      return { status: "error", message: "Confirm a positive net-sales total before submitting." };
    }
    if (!parsed.data.purchasingConfirmed) {
      return { status: "error", message: "Confirm the food-spend and credits position before submitting." };
    }
    if (!parsed.data.labourConfirmed || parsed.data.staffCost <= 0) {
      return { status: "error", message: "Confirm a positive aggregate weekly wage cost before submitting." };
    }
    if (parsed.data.stocktakeCompleted && (parsed.data.openingStock <= 0 || parsed.data.closingStock <= 0)) {
      return { status: "error", message: "Opening and closing stock are required when a stocktake is marked complete." };
    }
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

  const { data: reportId, error } = await supabase.rpc("save_weekly_report", {
    payload: {
      ...parsed.data,
      submittedBy: profile.id,
      status: parsed.data.intent === "submit" ? "submitted" : "draft",
    },
  });
  if (error) return { status: "error", message: "The report could not be saved. Check your site access and try again." };

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  revalidatePath("/costs");
  return {
    status: "success",
    message: parsed.data.intent === "submit" ? "Report submitted for review." : "Draft saved.",
    intent: parsed.data.intent,
    reportId: typeof reportId === "string" ? reportId : undefined,
  };
}

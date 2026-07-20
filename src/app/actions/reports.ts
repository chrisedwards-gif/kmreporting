"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { environment } from "@/lib/env";
import { requireSessionProfile } from "@/lib/auth/dal";
import { reportSaveErrorMessage } from "@/lib/reporting/errors";
import { isSundayToSaturday } from "@/lib/reporting/periods";
import { optionalNumericInput } from "@/lib/reporting/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ReportActionState = {
  status: "idle" | "success" | "error";
  message: string;
  intent?: "draft" | "submit";
  reportId?: string;
};

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const manualPurchaseSchema = z.object({
  description: z.string().trim().min(2).max(120),
  amount: z.coerce.number().positive().finite(),
  receiptReference: z.string().trim().max(120).default(""),
});
const manualPurchasesJson = z.string().max(12_000).transform((value, context) => {
  try { return JSON.parse(value) as unknown; }
  catch { context.addIssue({ code: "custom", message: "Check the off-system purchase entries." }); return z.NEVER; }
}).pipe(z.array(manualPurchaseSchema).max(25));
const salesDaySchema = z.object({ businessDate: z.iso.date(), grossSales: z.coerce.number().nonnegative().finite(), netSales: z.coerce.number().nonnegative().finite(), transactions: z.coerce.number().int().nonnegative(), covers: z.coerce.number().int().nonnegative() });
const salesItemSchema = z.object({ itemName: z.string().trim().min(1).max(180), category: z.string().trim().min(1).max(120).default("Uncategorised"), quantity: z.coerce.number().nonnegative().finite(), netSales: z.coerce.number().nonnegative().finite() });
const salesCategorySchema = z.object({ category: z.string().trim().min(1).max(120), quantity: z.coerce.number().nonnegative().finite(), netSales: z.coerce.number().nonnegative().finite() });
const salesInsightsJson = z.string().max(120_000).transform((value, context) => {
  try { return JSON.parse(value) as unknown; }
  catch { context.addIssue({ code: "custom", message: "The imported sales detail could not be validated." }); return z.NEVER; }
}).pipe(z.object({ days: z.array(salesDaySchema).max(7), items: z.array(salesItemSchema).max(100), categories: z.array(salesCategorySchema).max(40) }));

const reportSchema = z.object({
  siteId: z.string().min(1),
  weekStart: z.iso.date(),
  weekEnd: z.iso.date(),
  netSales: optionalNumericInput.pipe(z.number().nonnegative()),
  openingStock: optionalNumericInput.pipe(z.number().nonnegative()),
  purchases: optionalNumericInput.pipe(z.number().nonnegative()),
  credits: optionalNumericInput.pipe(z.number().nonnegative()),
  transfersIn: optionalNumericInput.pipe(z.number().nonnegative()),
  transfersOut: optionalNumericInput.pipe(z.number().nonnegative()),
  closingStock: optionalNumericInput.pipe(z.number().nonnegative()),
  adjustments: optionalNumericInput,
  wasteCost: optionalNumericInput.pipe(z.number().nonnegative()),
  staffCost: optionalNumericInput.pipe(z.number().nonnegative()),
  paidHours: optionalNumericInput.pipe(z.number().nonnegative()),
  pendingCredits: optionalNumericInput.pipe(z.number().nonnegative()),
  awaitingInvoice: optionalNumericInput.pipe(z.number().nonnegative()),
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
  manualPurchases: manualPurchasesJson.default([]),
  salesInsights: salesInsightsJson.optional(),
  wins: z.string().max(2_000).default(""),
  operationalIssues: z.string().max(2_000).default(""),
  staffingIssues: z.string().max(2_000).default(""),
  complianceIssues: z.string().max(2_000).default(""),
  equipmentIssues: z.string().max(2_000).default(""),
  actionsUnderway: z.string().max(2_000).default(""),
  supportNeeded: z.string().max(2_000).default(""),
  intent: z.enum(["draft", "submit"]),
});

export async function saveWeeklyReport(_previousState: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the report fields." };
  if (!isSundayToSaturday(parsed.data.weekStart, parsed.data.weekEnd)) return { status: "error", message: "The reporting period must run from Sunday through Saturday." };
  if (parsed.data.salesInsights?.days.some((day) => day.businessDate < parsed.data.weekStart || day.businessDate > parsed.data.weekEnd)) return { status: "error", message: "The imported daily sales include a date outside this reporting week." };
  if (parsed.data.intent === "submit") {
    if (!parsed.data.salesConfirmed || parsed.data.netSales <= 0) return { status: "error", message: "Confirm a positive net-sales total before submitting." };
    if (!parsed.data.purchasingConfirmed) return { status: "error", message: "Confirm the food-spend and credits position before submitting." };
    if (!parsed.data.labourConfirmed || parsed.data.staffCost <= 0) return { status: "error", message: "Confirm a positive aggregate weekly wage cost before submitting." };
    if (parsed.data.stocktakeCompleted && (parsed.data.openingStock <= 0 || parsed.data.closingStock <= 0)) return { status: "error", message: "Opening and closing stock are required when a stocktake is marked complete." };
  }

  if (environment.isDemo) return { status: "success", message: parsed.data.intent === "draft" ? "Demo draft validated. Connect Supabase to persist it." : "Demo report passed validation and is ready for management review." };
  const profile = await requireSessionProfile();
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data: reportId, error } = await supabase.rpc("save_weekly_report_v2", { payload: { ...parsed.data, submittedBy: profile.id, status: parsed.data.intent === "submit" ? "submitted" : "draft" } });
  if (error) {
    console.error("save_weekly_report failed", { code: error.code, message: error.message, details: error.details, hint: error.hint, siteId: parsed.data.siteId, userId: profile.id });
    return { status: "error", message: reportSaveErrorMessage(error, environment.isPreview) };
  }
  for (const path of ["/dashboard", "/reports", `/reports/${reportId}`, "/approvals", "/summary", "/costs"]) revalidatePath(path);
  return { status: "success", message: parsed.data.intent === "submit" ? "Report submitted for review." : "Draft saved.", intent: parsed.data.intent, reportId: typeof reportId === "string" ? reportId : undefined };
}

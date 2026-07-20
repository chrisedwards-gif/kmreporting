"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SalesInsightActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const payloadSchema = z.object({
  days: z.array(z.object({
    businessDate: z.iso.date(),
    grossSales: z.number().nonnegative().finite(),
    netSales: z.number().nonnegative().finite(),
    transactions: z.number().int().nonnegative(),
    covers: z.number().int().nonnegative(),
  })).max(7),
  items: z.array(z.object({
    itemName: z.string().trim().min(1).max(180),
    category: z.string().trim().min(1).max(120),
    quantity: z.number().nonnegative().finite(),
    netSales: z.number().nonnegative().finite(),
  })).max(100),
  categories: z.array(z.object({
    category: z.string().trim().min(1).max(120),
    quantity: z.number().nonnegative().finite(),
    netSales: z.number().nonnegative().finite(),
  })).max(40),
});

export async function saveReportSalesInsights(
  _previousState: SalesInsightActionState,
  formData: FormData,
): Promise<SalesInsightActionState> {
  await requireSessionProfile();
  const reportId = z.uuid().safeParse(formData.get("reportId"));
  if (!reportId.success) return { status: "error", message: "The weekly report could not be identified." };
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get("payload") ?? "")); }
  catch { return { status: "error", message: "The extracted EPOS detail could not be read." }; }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "The extracted EPOS detail is invalid." };
  if (!parsed.data.days.length && !parsed.data.items.length && !parsed.data.categories.length) {
    return { status: "error", message: "This export did not contain daily sales, item sales or category totals." };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_report_sales_insights", { target_report: reportId.data, payload: parsed.data });
  if (error) return { status: "error", message: error.message.includes("save_report_sales_insights") ? "Apply migrations 022 and 023 before importing detailed sales." : error.message };
  revalidatePath(`/reports/${reportId.data}`);
  revalidatePath("/dashboard");
  return { status: "success", message: `Sales insight updated: ${parsed.data.days.length} days, ${parsed.data.items.length} products and ${parsed.data.categories.length} categories.` };
}

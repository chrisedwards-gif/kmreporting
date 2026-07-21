"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type WasteActionState = { status: "idle" | "success" | "error"; message: string };

const optionalPositiveNumber = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  z.coerce.number().positive().finite().optional(),
);

const wasteSchema = z.object({
  id: z.string().optional().default(""),
  siteId: z.uuid(),
  businessDate: z.iso.date(),
  itemName: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  reason: z.string().trim().min(2).max(80),
  quantity: optionalPositiveNumber,
  unit: z.string().trim().max(30).default(""),
  estimatedCost: z.coerce.number().positive().finite(),
  notes: z.string().trim().max(1_000).default(""),
});

export async function saveWasteEntry(_previous: WasteActionState, formData: FormData): Promise<WasteActionState> {
  const parsed = wasteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the waste entry." };
  await requireSessionProfile();
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_waste_entry", {
    payload: {
      ...parsed.data,
      quantity: parsed.data.quantity ?? "",
    },
  });
  if (error) {
    console.error("waste save failed", { code: error.code, message: error.message, siteId: parsed.data.siteId });
    if (error.message.includes("already been submitted")) return { status: "error", message: "That date is already inside a submitted reporting week and is locked." };
    return { status: "error", message: "The waste entry could not be saved." };
  }
  for (const path of ["/waste", "/dashboard", "/reports", "/reports/new", "/summary", "/costs"]) revalidatePath(path);
  return { status: "success", message: "Waste logged. It will feed the weekly report covering this date." };
}

const deleteSchema = z.object({ entryId: z.uuid() });

export async function deleteWasteEntry(formData: FormData) {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await requireSessionProfile();
  const supabase = await createServerSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.rpc("delete_waste_entry", { target_entry: parsed.data.entryId });
  if (error) console.error("waste delete failed", { code: error.code, message: error.message, entryId: parsed.data.entryId });
  for (const path of ["/waste", "/dashboard", "/reports", "/reports/new", "/summary", "/costs"]) revalidatePath(path);
}

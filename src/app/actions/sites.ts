"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SiteActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const siteSchema = z.object({
  name: z.string().trim().min(2, "Enter a kitchen name.").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, "Use 2–24 capital letters, numbers or hyphens for the site code."),
  foodCostTarget: z.coerce.number().min(0).max(100),
  labourTarget: z.coerce.number().min(0).max(100),
  wasteTarget: z.coerce.number().min(0).max(100),
});

export async function createSite(
  _previousState: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the kitchen details." };
  }

  const profile = await requireRole(["admin"]);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { error } = await supabase.from("sites").insert({
    organisation_id: profile.organisationId,
    name: parsed.data.name,
    code: parsed.data.code,
    active: true,
    food_cost_target: parsed.data.foodCostTarget,
    labour_target: parsed.data.labourTarget,
    waste_target: parsed.data.wasteTarget,
  });

  if (error?.code === "23505") return { status: "error", message: "That site code is already in use." };
  if (error) return { status: "error", message: "The kitchen could not be created. Please try again." };

  revalidatePath("/settings/sites");
  revalidatePath("/reports/new");
  return { status: "success", message: `${parsed.data.name} is ready for weekly reporting.` };
}

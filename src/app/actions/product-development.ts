"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { PRODUCT_STATUSES } from "@/lib/product-development/calculations";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ProductDevelopmentActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const optionalUuid = z.union([z.literal(""), z.string().uuid()]);
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const optionalMoney = z.union([z.literal(""), z.coerce.number().min(0)]);

const productSchema = z.object({
  id: optionalUuid.default(""),
  siteId: optionalUuid.default(""),
  ownerProfileId: optionalUuid.default(""),
  title: z.string().trim().min(2, "Enter a product name.").max(160),
  category: z.string().trim().min(2).max(80).default("Dish"),
  status: z.enum(PRODUCT_STATUSES),
  targetLaunchDate: optionalDate.default(""),
  nextTrialDate: optionalDate.default(""),
  recipeSummary: z.string().max(8000).default(""),
  yieldText: z.string().max(160).default(""),
  portionText: z.string().max(160).default(""),
  foodCost: optionalMoney.default(""),
  sellPrice: optionalMoney.default(""),
  allergens: z.string().max(1000).default(""),
  trialNotes: z.string().max(12000).default(""),
  approvalNotes: z.string().max(8000).default(""),
});

export async function saveProductDevelopmentItem(
  _previous: ProductDevelopmentActionState,
  formData: FormData,
): Promise<ProductDevelopmentActionState> {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the product details." };
  }

  const input = parsed.data;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_product_development_item", {
    payload: {
      id: input.id,
      siteId: input.siteId,
      ownerProfileId: input.ownerProfileId,
      title: input.title,
      category: input.category,
      status: input.status,
      targetLaunchDate: input.targetLaunchDate,
      nextTrialDate: input.nextTrialDate,
      recipeSummary: input.recipeSummary,
      yieldText: input.yieldText,
      portionText: input.portionText,
      foodCost: input.foodCost === "" ? "" : String(input.foodCost),
      sellPrice: input.sellPrice === "" ? "" : String(input.sellPrice),
      allergens: input.allergens.split(",").map((item) => item.trim()).filter(Boolean),
      trialNotes: input.trialNotes,
      approvalNotes: input.approvalNotes,
    },
  });
  if (error) return { status: "error", message: error.message };
  revalidatePath("/product-development");
  return { status: "success", message: input.id ? "Product development record updated." : "Product development record created." };
}

export async function updateProductDevelopmentStatus(formData: FormData) {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(PRODUCT_STATUSES).parse(formData.get("status"));
  const supabase = await createServerSupabaseClient();
  if (!supabase) return;
  const { data: item } = await supabase
    .from("product_development_items")
    .select("id, site_id, owner_profile_id, title, category, target_launch_date, next_trial_date, recipe_summary, yield_text, portion_text, food_cost, sell_price, allergens, trial_notes, approval_notes")
    .eq("id", id)
    .maybeSingle();
  if (!item) return;
  await supabase.rpc("save_product_development_item", {
    payload: {
      id: item.id,
      siteId: item.site_id ?? "",
      ownerProfileId: item.owner_profile_id ?? "",
      title: item.title,
      category: item.category,
      status,
      targetLaunchDate: item.target_launch_date ?? "",
      nextTrialDate: item.next_trial_date ?? "",
      recipeSummary: item.recipe_summary,
      yieldText: item.yield_text,
      portionText: item.portion_text,
      foodCost: item.food_cost === null ? "" : String(item.food_cost),
      sellPrice: item.sell_price === null ? "" : String(item.sell_price),
      allergens: item.allergens ?? [],
      trialNotes: item.trial_notes,
      approvalNotes: item.approval_notes,
    },
  });
  revalidatePath("/product-development");
}

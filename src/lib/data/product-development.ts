import "server-only";

import { getEvidenceFiles, type EvidenceFile } from "@/lib/data/evidence";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ProductStatus } from "@/lib/product-development/calculations";

export type ProductDevelopmentItem = {
  id: string;
  siteId: string | null;
  siteName: string;
  ownerProfileId: string | null;
  ownerName: string;
  title: string;
  category: string;
  status: ProductStatus;
  targetLaunchDate: string | null;
  nextTrialDate: string | null;
  recipeSummary: string;
  methodText: string;
  yieldText: string;
  portionText: string;
  shelfLifeText: string;
  operationalPlan: string;
  foodCost: number | null;
  sellPrice: number | null;
  allergens: string[];
  trialNotes: string;
  approvalNotes: string;
  version: number;
  updatedAt: string;
  evidence: EvidenceFile[];
};

export type ProductDevelopmentOption = { id: string; name: string };

export async function getProductDevelopmentItems(): Promise<ProductDevelopmentItem[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("product_development_items")
    .select("id, site_id, owner_profile_id, title, category, status, target_launch_date, next_trial_date, recipe_summary, method_text, yield_text, portion_text, shelf_life_text, operational_plan, food_cost, sell_price, allergens, trial_notes, approval_notes, version, updated_at")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error || !data?.length) return [];

  const siteIds = [...new Set(data.flatMap((item) => item.site_id ? [item.site_id] : []))];
  const ownerIds = [...new Set(data.flatMap((item) => item.owner_profile_id ? [item.owner_profile_id] : []))];
  const [siteResult, ownerResult, evidenceByItem] = await Promise.all([
    siteIds.length ? supabase.from("sites").select("id, name").in("id", siteIds) : Promise.resolve({ data: [] }),
    ownerIds.length ? supabase.from("profiles").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [] }),
    getEvidenceFiles("product_development", data.map((item) => item.id)),
  ]);
  const sitesById = new Map((siteResult.data ?? []).map((item) => [item.id, item.name]));
  const ownersById = new Map((ownerResult.data ?? []).map((item) => [item.id, item.full_name]));

  return data.map((item) => ({
    id: item.id,
    siteId: item.site_id,
    siteName: item.site_id ? sitesById.get(item.site_id) ?? "Kitchen" : "Group-wide",
    ownerProfileId: item.owner_profile_id,
    ownerName: item.owner_profile_id ? ownersById.get(item.owner_profile_id) ?? "Owner" : "Unassigned",
    title: item.title,
    category: item.category,
    status: item.status as ProductStatus,
    targetLaunchDate: item.target_launch_date,
    nextTrialDate: item.next_trial_date,
    recipeSummary: item.recipe_summary,
    methodText: item.method_text ?? "",
    yieldText: item.yield_text,
    portionText: item.portion_text,
    shelfLifeText: item.shelf_life_text ?? "",
    operationalPlan: item.operational_plan ?? "",
    foodCost: item.food_cost === null ? null : Number(item.food_cost),
    sellPrice: item.sell_price === null ? null : Number(item.sell_price),
    allergens: item.allergens ?? [],
    trialNotes: item.trial_notes,
    approvalNotes: item.approval_notes,
    version: item.version,
    updatedAt: item.updated_at,
    evidence: evidenceByItem[item.id] ?? [],
  }));
}

export async function getProductDevelopmentOptions(): Promise<{
  sites: ProductDevelopmentOption[];
  owners: ProductDevelopmentOption[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { sites: [], owners: [] };
  const [{ data: sites }, { data: owners }] = await Promise.all([
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  return {
    sites: (sites ?? []).map((item) => ({ id: item.id, name: item.name })),
    owners: (owners ?? []).map((item) => ({ id: item.id, name: item.full_name })),
  };
}

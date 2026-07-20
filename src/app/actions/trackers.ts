"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TrackerActionState = { status: "idle" | "error" | "success"; message: string };

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const safeDocumentUrl = z.union([
  z.literal(""),
  z.string().url("The document link must be a full URL.").refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Document links must start with https:// or http://.",
  ),
]);

const sopSchema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]).default(""),
  siteId: z.string().uuid("Choose a kitchen."),
  title: z.string().trim().min(2, "Give the SOP a title.").max(180),
  category: z.enum(["stock_take", "ordering", "procure_wizard", "waste", "close_down", "date_labelling", "allergens", "pizza_standards", "prep_lists", "cleaning", "product_specifications", "training", "compliance", "other"]),
  priority: z.enum(["high", "medium", "low"]),
  owner: z.string().trim().min(2, "Name an owner.").max(120),
  status: z.enum(["not_started", "draft", "in_review", "live", "reviewed", "archived"]),
  dueDate: optionalDate.default(""),
  nextReviewDate: optionalDate.default(""),
  documentLink: safeDocumentUrl.default(""),
  notes: z.string().max(8000).default(""),
});

export async function saveSop(_previous: TrackerActionState, formData: FormData): Promise<TrackerActionState> {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (environment.isDemo) return { status: "error", message: "SOPs cannot be saved in the demo workspace." };
  const parsed = sopSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the SOP details." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_sop", { payload: parsed.data });
  if (error) return { status: "error", message: error.message };
  revalidatePath("/sops");
  revalidatePath("/dashboard");
  return { status: "success", message: parsed.data.id ? "SOP updated as a new version." : "SOP added." };
}

const trainingSchema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]).default(""),
  siteId: z.string().uuid("Choose a kitchen."),
  trainingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Set the training date."),
  teamMember: z.string().trim().min(2, "Name the team member.").max(160),
  topic: z.string().trim().min(2, "Name the topic.").max(240),
  method: z.string().max(500).default(""),
  result: z.string().max(1200).default(""),
  followUpRequired: z.boolean().default(false),
  followUpDate: optionalDate.default(""),
  signedOff: z.boolean().default(false),
  notes: z.string().max(8000).default(""),
}).refine((value) => !value.followUpRequired || Boolean(value.followUpDate), {
  message: "A follow-up needs a follow-up date.",
  path: ["followUpDate"],
});

export async function saveTrainingRecord(_previous: TrackerActionState, formData: FormData): Promise<TrackerActionState> {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (environment.isDemo) return { status: "error", message: "Training cannot be recorded in the demo workspace." };
  const parsed = trainingSchema.safeParse({
    ...Object.fromEntries(formData),
    followUpRequired: formData.get("followUpRequired") === "on",
    signedOff: formData.get("signedOff") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the training details." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_training_record", { payload: parsed.data });
  if (error) return { status: "error", message: error.message };
  revalidatePath("/training");
  revalidatePath("/dashboard");
  return { status: "success", message: parsed.data.id ? "Training record updated." : "Training recorded." };
}

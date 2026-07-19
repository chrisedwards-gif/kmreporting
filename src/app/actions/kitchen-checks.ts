"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type KitchenCheckActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const startSchema = z.object({
  templateId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function startKitchenCheck(formData: FormData) {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/checks?error=Choose+a+valid+check+date.");
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect("/checks?error=The+database+connection+is+unavailable.");
  const { data: runId, error } = await supabase.rpc("start_kitchen_check", {
    target_template: parsed.data.templateId,
    target_period_start: parsed.data.periodStart,
  });
  if (error || typeof runId !== "string") {
    redirect(`/checks?error=${encodeURIComponent(error?.message ?? "The kitchen check could not be started.")}`);
  }
  revalidatePath("/checks");
  redirect(`/checks/${runId}`);
}

const ratingSchema = z.enum(["green", "amber", "red", "na"]);
const responseSchema = z.object({
  itemId: z.string().uuid(),
  rating: z.union([z.literal(""), ratingSchema]),
  notes: z.string().max(4000).default(""),
  actionText: z.string().max(1000).default(""),
  ownerProfileId: z.union([z.literal(""), z.string().uuid()]).default(""),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
});
const saveSchema = z.object({
  runId: z.string().uuid(),
  intent: z.enum(["draft", "submit"]),
  responses: z.array(responseSchema),
});

export async function saveKitchenCheck(
  _previous: KitchenCheckActionState,
  formData: FormData,
): Promise<KitchenCheckActionState> {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { status: "error", message: "The kitchen check could not be read. Refresh and try again." };
  }
  const parsed = saveSchema.safeParse({
    ...(raw as Record<string, unknown>),
    intent: String(formData.get("intent") ?? "draft"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the highlighted fields." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data: runId, error } = await supabase.rpc("save_kitchen_check", {
    payload: {
      runId: parsed.data.runId,
      intent: parsed.data.intent,
      responses: parsed.data.responses.map((response) => ({
        ...response,
        rating: response.rating || null,
        evidencePaths: [],
      })),
    },
  });
  if (error || typeof runId !== "string") {
    return { status: "error", message: error?.message ?? "The kitchen check could not be saved." };
  }
  revalidatePath("/checks");
  revalidatePath(`/checks/${runId}`);
  return {
    status: "success",
    message: parsed.data.intent === "submit"
      ? "Kitchen check submitted. All Amber and Red items have been added to the action log."
      : "Draft saved. You can leave and continue this check later.",
  };
}

export async function reviewKitchenCheck(formData: FormData) {
  await requireRole(["admin", "group_manager"]);
  const runId = z.string().uuid().parse(formData.get("runId"));
  const notes = z.string().max(4000).catch("").parse(formData.get("notes") ?? "");
  const supabase = await createServerSupabaseClient();
  if (!supabase) return;
  await supabase.rpc("review_kitchen_check", { target_run: runId, notes });
  revalidatePath("/checks");
  revalidatePath(`/checks/${runId}`);
}

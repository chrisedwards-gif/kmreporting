"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { getWeekKpis } from "@/lib/data/one-to-ones";
import { environment } from "@/lib/env";
import { overallScore, SCORE_AREAS, type ScoreMap } from "@/lib/performance/scoring";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type OneToOneActionState = {
  status: "idle" | "error" | "success";
  message: string;
  reviewId?: string;
};

const scoreSchema = z.object({
  area: z.enum(SCORE_AREAS),
  score: z.union([z.coerce.number().min(1).max(5), z.literal("")]),
  evidence: z.string().max(2000).default(""),
  developmentNote: z.string().max(2000).default(""),
});

const actionItemSchema = z.object({
  id: z.string().default(""),
  priority: z.enum(["high", "medium", "low"]),
  action: z.string().max(500),
  successMeasure: z.string().max(500).default(""),
  owner: z.string().max(120),
  dueDate: z.string().default(""),
  status: z.enum(["not_started", "in_progress", "blocked", "complete", "cancelled"]).default("not_started"),
  outcome: z.string().max(1000).default(""),
  carriedFrom: z.string().default(""),
});

const reviewSchema = z.object({
  assignmentId: z.string().uuid(),
  weekCommencing: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  wins: z.record(z.string(), z.string().max(2000)),
  kpiManual: z.record(z.string(), z.string().max(2000)),
  summary: z.record(z.string(), z.string().max(4000)),
  scores: z.array(scoreSchema),
  actions: z.array(actionItemSchema).max(7, "A weekly 1-1 holds at most seven agreed actions."),
  intent: z.enum(["save", "finalise"]),
});

const parsePayload = (formData: FormData) => {
  try {
    const raw = JSON.parse(String(formData.get("payload") ?? "{}"));
    return reviewSchema.safeParse(raw);
  } catch {
    return reviewSchema.safeParse({});
  }
};

export async function saveOneToOne(
  _previous: OneToOneActionState,
  formData: FormData,
): Promise<OneToOneActionState> {
  await requireRole(["admin", "group_manager"]);
  if (environment.isDemo) {
    return { status: "error", message: "1-1 reviews cannot be saved in the demo workspace." };
  }
  const parsed = parsePayload(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the highlighted fields." };
  }
  const input = parsed.data;

  const scoreMap: ScoreMap = {};
  for (const item of input.scores) {
    if (item.score !== "") scoreMap[item.area] = item.score;
  }

  if (input.intent === "finalise") {
    const lowWithoutNote = input.scores.find(
      (item) => item.score !== "" && item.score < 3 && !item.developmentNote.trim(),
    );
    if (lowWithoutNote) {
      return { status: "error", message: `A score below 3 for ${lowWithoutNote.area.replaceAll("_", " ")} needs a development note before finalising.` };
    }
    const missingOwner = input.actions.find((item) => item.action.trim() && (!item.owner.trim() || !item.dueDate));
    if (missingOwner) {
      return { status: "error", message: "Every agreed action needs an owner and a due date before finalising." };
    }
    if (["amber", "red"].includes(input.kpiManual.compliance ?? "") && !input.kpiManual.complianceAction?.trim()) {
      return { status: "error", message: "Amber or red compliance needs a corrective action before finalising." };
    }
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: reviewId, error } = await supabase.rpc("save_one_to_one", {
    payload: {
      assignmentId: input.assignmentId,
      weekCommencing: input.weekCommencing,
      reviewDate: input.reviewDate,
      wins: input.wins,
      kpiManual: input.kpiManual,
      summary: input.summary,
      scores: input.scores.map((item) => ({ ...item, score: item.score === "" ? "" : String(item.score) })),
      actions: input.actions.filter((item) => item.action.trim()),
    },
  });
  if (error || typeof reviewId !== "string") {
    const safeMessage = error?.message ?? "The review could not be saved.";
    return {
      status: "error",
      message: safeMessage.includes("finalised") || safeMessage.includes("assigned") ? safeMessage : "The review could not be saved.",
    };
  }

  if (input.intent === "finalise") {
    const { data: assignment } = await supabase
      .from("site_manager_assignments")
      .select("site_id")
      .eq("id", input.assignmentId)
      .maybeSingle();
    const kpis = await getWeekKpis(assignment?.site_id ?? null, input.weekCommencing);
    const overall = overallScore(scoreMap);
    const { error: finaliseError } = await supabase.rpc("finalise_one_to_one", {
      target_review: reviewId,
      kpi_snapshot: { ...kpis, manual: input.kpiManual },
      overall,
    });
    if (finaliseError) return { status: "error", message: finaliseError.message };
    revalidatePath("/one-to-ones");
    revalidatePath(`/one-to-ones/${reviewId}`);
    return { status: "success", message: "Review finalised and locked.", reviewId };
  }

  revalidatePath("/one-to-ones");
  revalidatePath(`/one-to-ones/${reviewId}`);
  return { status: "success", message: "Draft saved.", reviewId };
}

export async function acknowledgeOneToOne(formData: FormData) {
  const reviewId = z.string().uuid().parse(formData.get("reviewId"));
  const supabase = await createServerSupabaseClient();
  if (!supabase || environment.isDemo) return;
  await supabase.rpc("acknowledge_one_to_one", { target_review: reviewId });
  revalidatePath("/one-to-ones");
  revalidatePath(`/one-to-ones/${reviewId}`);
}

export async function reopenOneToOne(formData: FormData) {
  await requireRole(["admin", "group_manager"]);
  const reviewId = z.string().uuid().parse(formData.get("reviewId"));
  const reason = z.string().min(3, "A reason is required.").parse(formData.get("reason"));
  const supabase = await createServerSupabaseClient();
  if (!supabase || environment.isDemo) return;
  await supabase.rpc("reopen_one_to_one", { target_review: reviewId, reason });
  revalidatePath("/one-to-ones");
  revalidatePath(`/one-to-ones/${reviewId}`);
}

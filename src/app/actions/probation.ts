"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { getProbationSummaries } from "@/lib/data/performance";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ProbationActionState = {
  status: "idle" | "success" | "error";
  message: string;
  reviewId?: string;
};

const optionalUuid = z.union([z.literal(""), z.string().uuid()]);
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

const reviewSchema = z.object({
  id: optionalUuid.default(""),
  managerProfileId: z.string().uuid(),
  siteId: optionalUuid.default(""),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a review date."),
  reviewStage: z.enum(["30_day", "60_day", "90_day", "final", "other"]),
  outcome: z.enum(["pending", "pass", "extend", "fail"]),
  extensionEndDate: optionalDate.default(""),
  notes: z.string().trim().max(12000).default(""),
  requiredActions: z.string().trim().max(12000).default(""),
});

const overrideSchema = z.object({
  managerId: z.string().uuid(),
  overrideRag: z.enum(["green", "amber", "red", "neutral"]),
  reason: z.string().trim().min(5, "Explain why management judgement differs from the calculated status.").max(2000),
});

const revokeSchema = z.object({
  overrideId: z.string().uuid(),
  reason: z.string().trim().min(5, "Explain why the override is being removed.").max(2000),
});

const revalidateProbation = () => {
  revalidatePath("/performance/probation");
  revalidatePath("/performance/managers");
};

export async function saveProbationReview(
  _previous: ProbationActionState,
  formData: FormData,
): Promise<ProbationActionState> {
  await requireRole(["admin", "group_manager"]);
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the probation review." };
  if (parsed.data.outcome === "extend" && !parsed.data.extensionEndDate) {
    return { status: "error", message: "An extension needs a revised probation end date." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data: reviewId, error } = await supabase.rpc("save_probation_review", {
    payload: {
      id: parsed.data.id,
      managerProfileId: parsed.data.managerProfileId,
      siteId: parsed.data.siteId,
      reviewDate: parsed.data.reviewDate,
      reviewStage: parsed.data.reviewStage,
      outcome: parsed.data.outcome,
      extensionEndDate: parsed.data.extensionEndDate,
      notes: parsed.data.notes,
      requiredActions: parsed.data.requiredActions,
    },
  });
  if (error || typeof reviewId !== "string") {
    return { status: "error", message: error?.message ?? "The probation review could not be saved." };
  }
  revalidateProbation();
  return { status: "success", message: "Probation review saved as a draft.", reviewId };
}

export async function finaliseProbationReview(
  _previous: ProbationActionState,
  formData: FormData,
): Promise<ProbationActionState> {
  const actor = await requireRole(["admin", "group_manager"]);
  const reviewId = z.string().uuid().safeParse(formData.get("reviewId"));
  if (!reviewId.success) return { status: "error", message: "The probation review could not be identified." };

  const managers = await getProbationSummaries();
  const manager = managers.find((item) => item.probationReviews.some((review) => review.id === reviewId.data));
  const review = manager?.probationReviews.find((item) => item.id === reviewId.data);
  if (!manager || !review || review.status !== "draft") return { status: "error", message: "Only a current draft can be finalised." };
  if (review.outcome === "pending") return { status: "error", message: "Choose Pass, Extend or Fail before finalising." };
  if (review.notes.trim().length < 10) return { status: "error", message: "Add meaningful review notes before finalising." };

  const snapshot = {
    schemaVersion: 1,
    review: {
      id: review.id,
      reviewDate: review.reviewDate,
      reviewStage: review.reviewStage,
      outcome: review.outcome,
      extensionEndDate: review.extensionEndDate,
      notes: review.notes,
      requiredActions: review.requiredActions,
    },
    manager: {
      id: manager.managerId,
      fullName: manager.fullName,
      roleTitle: manager.roleTitle,
      siteId: manager.siteId,
      siteName: manager.siteName,
      employmentStartDate: manager.employmentStartDate,
      probationEndDate: manager.probationEndDate,
      stageLabel: manager.stageLabel,
    },
    performance: {
      weightedScore: manager.weightedScore,
      calculatedRag: manager.calculatedRag,
      displayedRag: manager.displayRag,
      reviewCount: manager.reviewCount,
      latestReviewDate: manager.latestReviewDate,
      weights: manager.weights,
      override: manager.activeOverride,
    },
    evidence: review.evidence.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      evidenceType: file.evidenceType,
      caption: file.caption,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByName: file.uploadedByName,
      createdAt: file.createdAt,
    })),
    audit: {
      finalisedById: actor.id,
      finalisedByName: actor.fullName,
      finalisedAt: new Date().toISOString(),
    },
  };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("finalise_probation_review", {
    target_review: review.id,
    snapshot,
    score: manager.weightedScore,
    rag: manager.displayRag,
  });
  if (error) return { status: "error", message: error.message };
  revalidateProbation();
  return {
    status: "success",
    message: review.outcome === "extend"
      ? "Probation review finalised. The manager's probation end date has been extended."
      : "Probation review finalised and locked as an immutable record.",
    reviewId: review.id,
  };
}

export async function setProbationRagOverride(
  _previous: ProbationActionState,
  formData: FormData,
): Promise<ProbationActionState> {
  await requireRole(["admin", "group_manager"]);
  const parsed = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the override." };

  const manager = (await getProbationSummaries()).find((item) => item.managerId === parsed.data.managerId);
  if (!manager) return { status: "error", message: "Manager scorecard not found." };
  if (parsed.data.overrideRag === manager.calculatedRag) {
    return { status: "error", message: "The override matches the calculated status. Remove the override instead." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("set_rag_override", {
    target_entity_type: "manager_probation",
    target_entity_id: manager.managerId,
    target_metric_key: "weighted_score",
    calculated: manager.calculatedRag,
    override_value: parsed.data.overrideRag,
    override_reason: parsed.data.reason,
  });
  if (error) return { status: "error", message: error.message };
  revalidateProbation();
  return { status: "success", message: "Management RAG override recorded with its reason." };
}

export async function revokeProbationRagOverride(
  _previous: ProbationActionState,
  formData: FormData,
): Promise<ProbationActionState> {
  await requireRole(["admin", "group_manager"]);
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the removal reason." };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("revoke_rag_override", {
    target_override: parsed.data.overrideId,
    reason: parsed.data.reason,
  });
  if (error) return { status: "error", message: error.message };
  revalidateProbation();
  return { status: "success", message: "The override was removed; the calculated RAG is active again." };
}

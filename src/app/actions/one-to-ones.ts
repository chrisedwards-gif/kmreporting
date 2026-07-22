"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSessionProfile } from "@/lib/auth/dal";
import { getWeekKpis } from "@/lib/data/one-to-ones";
import { environment } from "@/lib/env";
import { deliverReminderWebhook } from "@/lib/notifications/delivery";
import { sendTransactionalEmail } from "@/lib/notifications/email";
import { buildFollowUpEmail, overallScore, SCORE_AREAS, type ScoreMap } from "@/lib/performance/scoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

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
  id: z.union([z.string().uuid(), z.literal("")]).default(""),
  isNew: z.boolean().default(false),
  priority: z.enum(["high", "medium", "low"]),
  action: z.string().max(500),
  successMeasure: z.string().max(500).default(""),
  owner: z.string().max(120).default(""),
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
  saveMode: z.enum(["manual", "autosave"]).default("manual"),
  intent: z.enum(["save", "finalise"]),
});

type ReviewInput = z.infer<typeof reviewSchema>;

const parsePayload = (formData: FormData) => {
  try {
    const raw = JSON.parse(String(formData.get("payload") ?? "{}")) as Record<string, unknown>;
    raw.intent = String(formData.get("intent") ?? raw.intent ?? "save");
    return reviewSchema.safeParse(raw);
  } catch {
    return reviewSchema.safeParse({});
  }
};

async function deliverFinalisedReview(reviewId: string, input: ReviewInput) {
  const admin = createAdminClient();
  const { data: review } = await admin
    .from("one_to_one_reviews")
    .select("organisation_id, manager_profile_id, site_id")
    .eq("id", reviewId)
    .maybeSingle();
  if (!review?.manager_profile_id) return "Review finalised, but no manager account is linked for delivery.";

  const [{ data: recipient }, { data: site }] = await Promise.all([
    admin.from("profiles").select("id, full_name, notification_email").eq("id", review.manager_profile_id).maybeSingle(),
    admin.from("sites").select("name").eq("id", review.site_id).maybeSingle(),
  ]);
  if (!recipient) return "Review finalised, but the manager profile could not be loaded for delivery.";

  const email = buildFollowUpEmail({
    firstName: recipient.full_name.split(" ")[0] || "there",
    weekCommencing: formatDate(input.weekCommencing),
    positives: [input.wins.biggestWin ?? "", input.wins.mostImproved ?? ""],
    developmentAreas: [input.summary.toImprove ?? ""],
    actions: input.actions
      .filter((item) => item.action.trim())
      .map((item) => ({ action: item.action, dueDate: item.dueDate ? formatDate(item.dueDate) : null })),
    support: input.summary.supportNeeded ?? "",
    nextReviewDate: null,
  });
  const actionPath = `/one-to-ones/${reviewId}`;
  const intendedEmail = recipient.notification_email?.trim() ?? "";
  const dedupeKey = `one-to-one:${reviewId}`;
  const { data: logged, error: logError } = await admin.from("notification_log").insert({
    organisation_id: review.organisation_id,
    recipient_id: recipient.id,
    site_id: review.site_id,
    one_to_one_review_id: reviewId,
    notification_type: "one_to_one_finalised",
    dedupe_key: `${dedupeKey}:${crypto.randomUUID()}`,
    delivery_status: intendedEmail ? "queued" : "failed",
    recipient_email: intendedEmail || null,
    subject: email.subject,
    message: email.body,
    action_path: actionPath,
    error_message: intendedEmail ? null : "The manager profile has no notification email.",
  }).select("id").single();

  if (logError || !logged) return "Review finalised, but the email record could not be queued.";
  if (!intendedEmail) return "Review finalised. Add a notification email to the manager account before resending.";

  const resendDelivery = await sendTransactionalEmail({
    to: intendedEmail,
    subject: email.subject,
    text: email.body,
    idempotencyKey: dedupeKey,
  });
  if (resendDelivery.configured) {
    await admin.from("notification_log").update({
      delivery_status: resendDelivery.ok ? "sent" : "failed",
      provider_reference: resendDelivery.providerReference || null,
      error_message: resendDelivery.ok ? null : resendDelivery.error,
      sent_at: resendDelivery.ok ? new Date().toISOString() : null,
    }).eq("id", logged.id);
    revalidatePath("/notifications");
    return resendDelivery.ok
      ? `Review finalised and sent by Resend to ${environment.reminderRecipientOverride ?? intendedEmail}${environment.reminderRecipientOverride ? " through the UAT override" : ""}.`
      : `Review finalised, but Resend delivery failed: ${resendDelivery.error}`;
  }

  if (!environment.reminderWebhookUrl) {
    revalidatePath("/notifications");
    return `Review finalised and queued for ${intendedEmail}. Configure Resend or the delivery webhook before expecting an email.`;
  }

  const actualEmail = environment.reminderRecipientOverride ?? intendedEmail;
  const delivery = await deliverReminderWebhook(environment.reminderWebhookUrl, {
    test: false,
    kind: "one_to_one_finalised",
    recipient: { ...recipient, notification_email: actualEmail },
    intendedRecipientEmail: intendedEmail,
    recipientOverridden: Boolean(environment.reminderRecipientOverride),
    siteName: site?.name ?? "Kitchen",
    reviewId,
    subject: email.subject,
    message: email.body,
    actionPath,
  });

  await admin.from("notification_log").update({
    delivery_status: delivery.ok ? "sent" : "failed",
    provider_reference: delivery.providerReference || null,
    error_message: delivery.ok ? null : delivery.error,
    sent_at: delivery.ok ? new Date().toISOString() : null,
  }).eq("id", logged.id);
  revalidatePath("/notifications");

  return delivery.ok
    ? `Review finalised and sent to ${actualEmail}${environment.reminderRecipientOverride ? " through the UAT override" : ""}.`
    : `Review finalised, but email delivery failed: ${delivery.error}`;
}

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
      message: safeMessage.includes("finalised") || safeMessage.includes("assigned") || safeMessage.includes("development")
        ? safeMessage
        : `The review could not be saved${error?.message ? `: ${error.message}` : "."}`,
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
    const deliveryMessage = await deliverFinalisedReview(reviewId, input);
    revalidatePath("/one-to-ones");
    revalidatePath("/performance/actions");
    revalidatePath("/performance/probation");
    revalidatePath(`/one-to-ones/${reviewId}`);
    return { status: "success", message: deliveryMessage, reviewId };
  }

  if (input.saveMode !== "autosave") {
    revalidatePath("/one-to-ones");
    revalidatePath(`/one-to-ones/${reviewId}`);
  }
  return { status: "success", message: input.saveMode === "autosave" ? "Draft autosaved." : "Draft saved. You can leave this page and continue it from Manager 1-1s.", reviewId };
}

export async function autosaveOneToOne(payload: string): Promise<OneToOneActionState> {
  let autosavePayload = payload;
  try {
    autosavePayload = JSON.stringify({ ...JSON.parse(payload), saveMode: "autosave" });
  } catch {
    return { status: "error", message: "The autosave payload is invalid." };
  }
  const formData = new FormData();
  formData.set("payload", autosavePayload);
  formData.set("intent", "save");
  return saveOneToOne({ status: "idle", message: "" }, formData);
}

export async function acknowledgeOneToOne(
  _previous: OneToOneActionState,
  formData: FormData,
): Promise<OneToOneActionState> {
  const profile = await requireSessionProfile();
  const parsed = z.object({
    reviewId: z.string().uuid(),
    response: z.string().max(4000, "Keep the response below 4,000 characters.").default(""),
  }).safeParse({
    reviewId: formData.get("reviewId"),
    response: formData.get("response") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the acknowledgement and try again." };
  }
  if (environment.isDemo) {
    return { status: "error", message: "1-1 acknowledgements are read-only in the demo workspace." };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable. Your comment has not been submitted." };
  const { error } = await supabase.rpc("acknowledge_one_to_one", {
    target_review: parsed.data.reviewId,
    response: parsed.data.response,
  });
  if (error) {
    console.error("1-1 acknowledgement failed", { code: error.code, reviewId: parsed.data.reviewId, actorId: profile.id });
    const message = error.message.toLowerCase();
    return {
      status: "error",
      message: message.includes("already been acknowledged")
        ? "This review has already been acknowledged. Refresh to see the recorded response."
        : message.includes("finalised")
          ? "Only a finalised review can be acknowledged. Refresh and check its current status."
          : message.includes("named manager") || message.includes("group management")
            ? "This review can only be acknowledged by the named Kitchen Manager or group management."
            : "The acknowledgement could not be recorded. Your comment is still on this page; refresh the review status and try again.",
    };
  }
  revalidatePath("/one-to-ones");
  revalidatePath(`/one-to-ones/${parsed.data.reviewId}`);
  return {
    status: "success",
    message: parsed.data.response.trim()
      ? "Your acknowledgement and comment have been recorded."
      : "Your acknowledgement has been recorded.",
    reviewId: parsed.data.reviewId,
  };
}

export async function updateOwnManagerAction(formData: FormData) {
  const actionId = z.string().uuid().parse(formData.get("actionId"));
  const status = z.enum(["not_started", "in_progress", "blocked", "complete"]).parse(formData.get("status"));
  const outcome = z.string().max(1000).catch("").parse(formData.get("outcome") ?? "");
  const supabase = await createServerSupabaseClient();
  if (!supabase || environment.isDemo) return;
  await supabase.rpc("update_own_manager_action", {
    target_action: actionId,
    next_status: status,
    next_outcome: outcome,
  });
  revalidatePath("/performance/actions");
  revalidatePath("/one-to-ones");
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { environment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaFeedbackActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const feedbackSchema = z.object({
  siteId: z.uuid(),
  businessDate: z.iso.date(),
  staffingRating: z.enum([
    "very_under",
    "slightly_under",
    "about_right",
    "slightly_over",
    "very_over",
  ]),
  serviceImpact: z.enum(["none", "minor", "major"]),
  leftEarlyCount: z.coerce.number().int().min(0).max(50),
  stayedLateCount: z.coerce.number().int().min(0).max(50),
  absenceCount: z.coerce.number().int().min(0).max(50),
  wouldRepeat: z.enum(["yes", "no", "unsure"]),
  notes: z.string().trim().max(2000).optional().default(""),
});

const allowedPeriods = new Set(["prep", "lunch", "afternoon", "evening_peak", "close"]);
const allowedCauses = new Set([
  "forecast_low",
  "forecast_high",
  "unexpected_walk_ins",
  "delivery_spike",
  "event_impact",
  "sickness",
  "poor_deployment",
  "skill_mix",
  "prep_shortage",
  "equipment_issue",
  "left_early",
  "stayed_late",
]);

const londonToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

export async function saveRotaShiftFeedback(
  _previous: RotaFeedbackActionState,
  formData: FormData,
): Promise<RotaFeedbackActionState> {
  const parsed = feedbackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the shift feedback." };
  }

  const profile = await requireSessionProfile();
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) {
    return { status: "error", message: "Your role cannot submit shift feedback." };
  }
  if (!scopeContainsSite(profile.siteScopeIds, parsed.data.siteId)) {
    return { status: "error", message: "That kitchen is outside your workspace." };
  }
  if (parsed.data.businessDate > londonToday()) {
    return { status: "error", message: "Shift feedback can only be submitted after the shift date begins." };
  }

  const affectedPeriods = formData
    .getAll("affectedPeriods")
    .map(String)
    .filter((value) => allowedPeriods.has(value));
  const causes = formData
    .getAll("causes")
    .map(String)
    .filter((value) => allowedCauses.has(value));
  const wouldRepeat = parsed.data.wouldRepeat === "unsure" ? null : parsed.data.wouldRepeat === "yes";

  if (environment.isDemo) {
    return { status: "success", message: "Demo feedback validated. Live workspaces retain it for forecast learning." };
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("rota_shift_feedback").upsert({
      organisation_id: profile.organisationId,
      site_id: parsed.data.siteId,
      business_date: parsed.data.businessDate,
      staffing_rating: parsed.data.staffingRating,
      affected_periods: affectedPeriods,
      causes,
      service_impact: parsed.data.serviceImpact,
      left_early_count: parsed.data.leftEarlyCount,
      stayed_late_count: parsed.data.stayedLateCount,
      absence_count: parsed.data.absenceCount,
      would_repeat: wouldRepeat,
      notes: parsed.data.notes,
      submitted_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "site_id,business_date,submitted_by" });

    if (error) {
      console.error("rota shift feedback save failed", {
        code: error.code,
        message: error.message,
        siteId: parsed.data.siteId,
        businessDate: parsed.data.businessDate,
      });
      return { status: "error", message: "The shift feedback could not be saved." };
    }

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "rota.shift_feedback_saved",
      entity_type: "site",
      entity_id: parsed.data.siteId,
      detail: {
        business_date: parsed.data.businessDate,
        staffing_rating: parsed.data.staffingRating,
        service_impact: parsed.data.serviceImpact,
        affected_periods: affectedPeriods,
        causes,
      },
    });

    revalidatePath("/rotas");
    revalidatePath("/rotas/feedback");
    return {
      status: "success",
      message: "Shift feedback saved. It will be compared with sales and actual labour as history builds.",
    };
  } catch {
    return { status: "error", message: "The shift feedback service is unavailable." };
  }
}

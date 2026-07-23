import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type RotaWeekFeedback = {
  businessDate: string;
  staffingRating: "very_under" | "slightly_under" | "about_right" | "slightly_over" | "very_over";
  serviceImpact: "none" | "minor" | "major";
  updatedAt: string;
};

export async function getRotaWeekFeedback(input: {
  organisationId: string;
  siteId: string;
  profileId: string;
  weekStart: string;
  weekEnd: string;
}): Promise<RotaWeekFeedback[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("rota_shift_feedback")
      .select("business_date, staffing_rating, service_impact, updated_at")
      .eq("organisation_id", input.organisationId)
      .eq("site_id", input.siteId)
      .eq("submitted_by", input.profileId)
      .gte("business_date", input.weekStart)
      .lte("business_date", input.weekEnd)
      .order("business_date");

    if (error) return [];
    return (data ?? []).map((row) => ({
      businessDate: String(row.business_date),
      staffingRating: row.staffing_rating as RotaWeekFeedback["staffingRating"],
      serviceImpact: row.service_impact as RotaWeekFeedback["serviceImpact"],
      updatedAt: String(row.updated_at),
    }));
  } catch {
    return [];
  }
}

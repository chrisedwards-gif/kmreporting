import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function getWeeklyReportId(siteId: string, weekCommencing: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: period } = await supabase
    .from("reporting_periods")
    .select("id")
    .eq("week_start", weekCommencing)
    .maybeSingle();
  if (!period) return null;

  const { data: report } = await supabase
    .from("weekly_reports")
    .select("id")
    .eq("period_id", period.id)
    .eq("site_id", siteId)
    .maybeSingle();
  return report?.id ?? null;
}

import "server-only";

import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { RotaPlanMark } from "@/lib/rota/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaBuilderMetadata = {
  marks: RotaPlanMark[];
  notes: Array<{
    staffProfileId: string | null;
    shiftStart: string;
    shiftEnd: string;
    note: string;
  }>;
};

const emptyMetadata: RotaBuilderMetadata = { marks: [], notes: [] };

export async function getRotaBuilderMetadata(input: {
  planId: string;
  organisationId: string;
  siteId: string;
}): Promise<RotaBuilderMetadata> {
  try {
    const admin = createAdminClient();
    const [shiftResult, markResult] = await Promise.all([
      admin
        .from("rota_plan_shifts")
        .select("staff_profile_id, shift_start, shift_end, note")
        .eq("plan_id", input.planId)
        .eq("organisation_id", input.organisationId)
        .eq("site_id", input.siteId),
      admin
        .from("rota_plan_marks")
        .select("staff_profile_id, business_date, mark_type, note")
        .eq("plan_id", input.planId)
        .eq("organisation_id", input.organisationId)
        .eq("site_id", input.siteId)
        .order("business_date"),
    ]);

    if (shiftResult.error || markResult.error) return emptyMetadata;

    return {
      notes: (shiftResult.data ?? []).map((row) => ({
        staffProfileId: row.staff_profile_id,
        shiftStart: row.shift_start,
        shiftEnd: row.shift_end,
        note: String(row.note ?? ""),
      })),
      marks: (markResult.data ?? []).map((row) => ({
        staffProfileId: String(row.staff_profile_id),
        businessDate: String(row.business_date),
        markType: row.mark_type as RotaPlanMark["markType"],
        note: String(row.note ?? ""),
      })),
    };
  } catch {
    return emptyMetadata;
  }
}

export function applyRotaBuilderNotes(
  plan: StoredRotaPlan,
  metadata: RotaBuilderMetadata,
): StoredRotaPlan {
  const noteByShift = new Map(
    metadata.notes.map((item) => [
      `${item.staffProfileId ?? "open"}|${item.shiftStart}|${item.shiftEnd}`,
      item.note,
    ]),
  );

  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      shifts: day.shifts.map((shift) => ({
        ...shift,
        note: noteByShift.get(
          `${shift.staffProfileId ?? "open"}|${shift.shiftStart}|${shift.shiftEnd}`,
        ) ?? shift.note ?? "",
      })),
    })),
  };
}

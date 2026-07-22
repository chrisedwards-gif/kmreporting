"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { environment } from "@/lib/env";
import type { RotaPlanMark } from "@/lib/rota/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaBuilderActionState = {
  status: "success" | "error";
  message: string;
};

const timeStamp = z.string().min(20).max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "A shift has an invalid date or time.",
});

const shiftSchema = z.object({
  staffProfileId: z.string().uuid().nullable(),
  staffName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().min(1).max(120),
  shiftStart: timeStamp,
  shiftEnd: timeStamp,
  breakMinutes: z.number().int().min(0).max(180),
  requiredSkill: z.string().trim().max(120).nullable(),
  assignmentReason: z.string().trim().max(500),
  note: z.string().trim().max(1500).optional().default(""),
});

const markSchema = z.object({
  staffProfileId: z.string().uuid(),
  businessDate: z.iso.date(),
  markType: z.enum(["day_off", "unavailable", "leave", "training"]),
  note: z.string().trim().max(1000).optional().default(""),
});

const daySchema = z.object({
  businessDate: z.iso.date(),
  shifts: z.array(shiftSchema).max(100),
});

const draftSchema = z.object({
  planId: z.string().uuid(),
  siteId: z.string().uuid(),
  weekStart: z.iso.date(),
  days: z.array(daySchema).min(1).max(7),
  marks: z.array(markSchema).max(100),
});

export type SaveRotaBuilderDraftInput = z.input<typeof draftSchema>;

const londonDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(value));

const localMinutes = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
};

const slotMinutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};

const overlaps = (startA: number, endA: number, startB: number, endB: number) =>
  startA < endB && endA > startB;

export async function saveRotaBuilderDraft(
  input: SaveRotaBuilderDraftInput,
): Promise<RotaBuilderActionState> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the rota draft." };
  }

  const profile = await requireSessionProfile();
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) {
    return { status: "error", message: "Your role cannot edit this rota draft." };
  }
  if (!scopeContainsSite(profile.siteScopeIds, parsed.data.siteId)) {
    return { status: "error", message: "That kitchen is outside your workspace." };
  }

  const duplicateDays = new Set<string>();
  for (const day of parsed.data.days) {
    if (duplicateDays.has(day.businessDate)) {
      return { status: "error", message: "The draft contains the same day more than once." };
    }
    duplicateDays.add(day.businessDate);
    for (const shift of day.shifts) {
      if (londonDate(shift.shiftStart) !== day.businessDate || londonDate(shift.shiftEnd) !== day.businessDate) {
        return { status: "error", message: "Every shift must start and finish on its selected rota day." };
      }
      const durationMinutes = (new Date(shift.shiftEnd).getTime() - new Date(shift.shiftStart).getTime()) / 60_000;
      if (durationMinutes <= shift.breakMinutes || durationMinutes > 18 * 60) {
        return { status: "error", message: "Check shift times and breaks before saving." };
      }
    }
  }

  if (environment.isDemo) {
    return { status: "success", message: "Demo draft updated for this session. Live workspaces save the audited rota." };
  }

  try {
    const admin = createAdminClient();
    const [{ data: plan, error: planError }, { data: dayRows, error: dayError }, { data: staffJson, error: staffError }] = await Promise.all([
      admin
        .from("rota_plans")
        .select("id, site_id, organisation_id, week_start, week_end, status")
        .eq("id", parsed.data.planId)
        .eq("site_id", parsed.data.siteId)
        .eq("organisation_id", profile.organisationId)
        .maybeSingle(),
      admin
        .from("rota_plan_days")
        .select("business_date, evidence")
        .eq("plan_id", parsed.data.planId)
        .eq("site_id", parsed.data.siteId),
      admin.rpc("get_rota_private_staff", {
        target_organisation: profile.organisationId,
        target_site: parsed.data.siteId,
        target_week_start: parsed.data.weekStart,
      }),
    ]);

    if (planError || dayError || staffError || !plan) {
      return { status: "error", message: "The saved rota could not be checked before updating." };
    }
    if (String(plan.week_start) !== parsed.data.weekStart || plan.status === "superseded") {
      return { status: "error", message: "This rota version is no longer the editable week." };
    }

    const staff = ((staffJson ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.staffName ?? "Team member"),
      minimumHours: Number(row.minimumWeeklyHours ?? 0),
      targetHours: Number(row.targetWeeklyHours ?? 0),
      maximumHours: Number(row.maximumWeeklyHours ?? 0),
    }));
    const staffIds = new Set(staff.map((person) => person.id));

    for (const day of parsed.data.days) {
      for (const shift of day.shifts) {
        if (shift.staffProfileId && !staffIds.has(shift.staffProfileId)) {
          return { status: "error", message: "A shift is assigned to someone outside this kitchen." };
        }
      }
    }
    for (const mark of parsed.data.marks) {
      if (!staffIds.has(mark.staffProfileId)) {
        return { status: "error", message: "A day marker belongs to someone outside this kitchen." };
      }
    }

    const evidenceByDate = new Map(
      (dayRows ?? []).map((row) => [
        String(row.business_date),
        (row.evidence?.coverage ?? []) as Array<{
          slotTime: string;
          required: number;
          assigned: number;
          demandWeight: number;
        }>,
      ]),
    );

    const plannedHours = new Map<string, number>();
    const days = parsed.data.days.map((day) => {
      const sortedSlots = [...(evidenceByDate.get(day.businessDate) ?? [])]
        .sort((a, b) => a.slotTime.localeCompare(b.slotTime));
      const coverage = sortedSlots.map((slot, index) => {
        const start = slotMinutes(slot.slotTime);
        const next = sortedSlots[index + 1];
        const end = next ? slotMinutes(next.slotTime) : start + 60;
        const assigned = day.shifts.filter((shift) => {
          if (!shift.staffProfileId) return false;
          return overlaps(localMinutes(shift.shiftStart), localMinutes(shift.shiftEnd), start, end);
        }).length;
        return { ...slot, assigned };
      });

      for (const shift of day.shifts) {
        if (!shift.staffProfileId) continue;
        const paidMinutes = (new Date(shift.shiftEnd).getTime() - new Date(shift.shiftStart).getTime()) / 60_000 - shift.breakMinutes;
        plannedHours.set(shift.staffProfileId, (plannedHours.get(shift.staffProfileId) ?? 0) + paidMinutes / 60);
      }

      const warnings: string[] = [];
      const gaps = coverage.filter((slot) => slot.assigned < slot.required);
      const openShifts = day.shifts.filter((shift) => !shift.staffProfileId);
      const shortShifts = day.shifts.filter((shift) => {
        const paid = (new Date(shift.shiftEnd).getTime() - new Date(shift.shiftStart).getTime()) / 60_000 - shift.breakMinutes;
        return Boolean(shift.staffProfileId && paid < 360);
      });
      if (gaps.length) warnings.push(`${gaps.length} time slot${gaps.length === 1 ? " is" : "s are"} below required cover.`);
      if (openShifts.length) warnings.push(`${openShifts.length} open shift${openShifts.length === 1 ? " needs" : "s need"} assigning.`);
      if (shortShifts.length) warnings.push(`${shortShifts.length} shift${shortShifts.length === 1 ? " is" : "s are"} under six paid hours.`);

      return {
        businessDate: day.businessDate,
        coverage,
        warnings,
        shifts: day.shifts.map((shift) => ({
          ...shift,
          assignmentReason: shift.assignmentReason || "Manager draft",
        })),
      };
    });

    const warnings = days.flatMap((day) => day.warnings.map((warning) => `${day.businessDate}: ${warning}`));
    for (const person of staff) {
      const hours = plannedHours.get(person.id) ?? 0;
      if (hours + 0.01 < person.minimumHours) warnings.push(`${person.name} is ${(person.minimumHours - hours).toFixed(1)}h below minimum hours.`);
      if (hours > person.maximumHours + 0.01) warnings.push(`${person.name} is ${(hours - person.maximumHours).toFixed(1)}h above maximum hours.`);
    }

    const marks: RotaPlanMark[] = parsed.data.marks.map((mark) => ({ ...mark }));
    const { error } = await admin.rpc("save_rota_builder_draft_private", {
      target_organisation: profile.organisationId,
      target_site: parsed.data.siteId,
      target_plan: parsed.data.planId,
      target_actor: profile.id,
      payload: { days, marks, warnings },
    });

    if (error) {
      console.error("rota draft save failed", { code: error.code, message: error.message, planId: parsed.data.planId });
      return { status: "error", message: "The rota draft could not be saved atomically. Your on-screen changes are still available." };
    }

    revalidatePath("/rotas");
    return { status: "success", message: "Draft saved. The weekly hours, cover and private labour totals were recalculated." };
  } catch (error) {
    console.error("rota draft service failed", { message: error instanceof Error ? error.message : "unknown" });
    return { status: "error", message: "The secure rota draft service is unavailable." };
  }
}

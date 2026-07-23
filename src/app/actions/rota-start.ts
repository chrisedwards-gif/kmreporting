"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";
import { environment } from "@/lib/env";
import { buildRotaPlan } from "@/lib/rota/planner";
import type { RotaPlan } from "@/lib/rota/types";
import { createRotaWarning } from "@/lib/rota/warnings";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaStartActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const schema = z.object({
  siteId: z.string().uuid(),
  weekStart: z.iso.date(),
});

export async function createBlankRotaDraft(
  _previous: RotaStartActionState,
  formData: FormData,
): Promise<RotaStartActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a kitchen and a Monday week start." };

  const profile = await requireSessionProfile();
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) {
    return { status: "error", message: "Your role cannot create rota drafts." };
  }
  if (!scopeContainsSite(profile.siteScopeIds, parsed.data.siteId)) {
    return { status: "error", message: "That kitchen is outside your workspace." };
  }

  const workspace = await getRotaPlanningWorkspace({
    profile,
    requestedSiteId: parsed.data.siteId,
    requestedWeekStart: parsed.data.weekStart,
  });
  if (!workspace.selectedSite || workspace.error) {
    return { status: "error", message: workspace.error ?? "The rota workspace is unavailable." };
  }
  if (!workspace.history.length) {
    return { status: "error", message: "Import dated sales before creating a forecast-led rota week." };
  }

  const generated = buildRotaPlan({
    weekStart: workspace.weekStart,
    labourTargetPct: workspace.selectedSite.labourTarget,
    history: workspace.history,
    events: workspace.events,
    dayRules: workspace.dayRules,
    demand: workspace.demand,
    staff: workspace.staff,
    existingShifts: workspace.existingShifts,
    forecastWeeks: workspace.forecastWeeks,
    minimumHistoryWeeks: workspace.minimumHistoryWeeks,
    minimumRestHours: workspace.minimumRestHours,
    intervalMinutes: workspace.intervalMinutes,
    salesPerLabourHourTarget: workspace.salesPerLabourHourTarget,
  });
  const plan = asBlankDraft(generated);

  if (environment.isDemo) {
    return { status: "success", message: "Blank demo week created with forecast and cover guidance." };
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_rota_plan_private", {
      target_organisation: profile.organisationId,
      target_site: parsed.data.siteId,
      target_actor: profile.id,
      payload: stripPrivateShiftCosts(plan),
    });
    if (error) {
      console.error("blank rota draft save failed", { code: error.code, message: error.message });
      return { status: "error", message: "The blank rota week could not be saved." };
    }
    revalidatePath("/rotas");
    return { status: "success", message: "Blank rota week created. Build the shifts manually using the forecast and heat map." };
  } catch {
    return { status: "error", message: "The secure rota draft service is unavailable." };
  }
}

function asBlankDraft(plan: RotaPlan): RotaPlan {
  const days = plan.days.map((day) => ({
    ...day,
    plannedCost: day.fixedLabourCost,
    plannedHours: 0,
    coverage: day.coverage.map((slot) => ({ ...slot, assigned: 0 })),
    shifts: [],
    warnings: day.coverage.length
      ? [createRotaWarning("This day has not been staffed yet.", "all")]
      : [],
  }));
  return {
    ...plan,
    plannedCost: days.reduce((sum, day) => sum + day.plannedCost, 0),
    plannedHours: 0,
    explanation: "A blank manager-built rota draft with forecast, demand and labour guidance preserved.",
    warnings: [createRotaWarning("The rota draft is blank. Add shifts and save before relying on the score.", "all")],
    days,
  };
}

function stripPrivateShiftCosts(plan: RotaPlan) {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      shifts: day.shifts.map((shift) => {
        const safeShift: Partial<typeof shift> = { ...shift };
        delete safeShift.privateCost;
        return safeShift;
      }),
    })),
  };
}

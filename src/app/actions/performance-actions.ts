"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type PerformanceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  recordId?: string;
};

const createActionSchema = z.object({
  managerProfileId: z.string().uuid(),
  siteId: z.string().uuid(),
  priority: z.enum(["high", "medium", "low"]),
  action: z.string().trim().min(3, "Describe the action.").max(500),
  successMeasure: z.string().trim().max(500).default(""),
  owner: z.string().trim().min(2, "Add the person responsible.").max(120),
  dueDate: z.iso.date("Add a valid due date."),
});

export async function createPerformanceAction(
  _previous: PerformanceActionState,
  formData: FormData,
): Promise<PerformanceActionState> {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (environment.isDemo) {
    return { status: "error", message: "Actions are read-only in the test workspace." };
  }

  const parsed = createActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the action details." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data: recordId, error } = await supabase.rpc("create_manager_action", {
    payload: parsed.data,
  });
  if (error || typeof recordId !== "string") {
    return {
      status: "error",
      message: error?.message ?? "The action could not be added.",
    };
  }

  for (const path of ["/performance/actions", "/one-to-ones", "/dashboard"]) revalidatePath(path);
  return {
    status: "success",
    message: "The action is live in the manager’s Action Log.",
    recordId,
  };
}

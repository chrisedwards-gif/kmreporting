"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SalaryActionState = { status: "idle" | "success" | "error"; message: string };

const salarySchema = z.object({
  id: z.string().optional().default(""),
  siteId: z.uuid(),
  profileId: z.string().optional().default(""),
  staffName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().max(120).default(""),
  annualSalary: z.coerce.number().positive().finite(),
  oncostRate: z.coerce.number().min(0).max(100).finite(),
  allocationPct: z.coerce.number().positive().max(100).finite(),
  validFrom: z.iso.date(),
  validTo: z.string().optional().default(""),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function saveSalaryAllocation(_previous: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salarySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the salary allocation." };
  await requireActualRole(["admin"]);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { error } = await supabase.rpc("save_salary_allocation", { payload: parsed.data });
  if (error) {
    console.error("salary allocation save failed", { code: error.code, message: error.message, siteId: parsed.data.siteId });
    return { status: "error", message: "The salary allocation could not be saved." };
  }
  revalidateSalaryRoutes();
  return { status: "success", message: "Salary allocation saved and applicable report snapshots recalculated." };
}

const deleteSchema = z.object({ allocationId: z.uuid() });

export async function deleteSalaryAllocation(formData: FormData) {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await requireActualRole(["admin"]);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.rpc("delete_salary_allocation", { target_allocation: parsed.data.allocationId });
  if (error) console.error("salary allocation delete failed", { code: error.code, message: error.message, allocationId: parsed.data.allocationId });
  revalidateSalaryRoutes();
}

const toggleSchema = z.object({ siteId: z.uuid(), includeSalaryCosts: z.enum(["true", "false"]).transform((value) => value === "true") });

export async function setSiteSalaryInclusion(_previous: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The kitchen salary setting is invalid." };
  const profile = await requireActualRole(["admin"]);
  try {
    const admin = createAdminClient();
    const { data: site, error } = await admin
      .from("sites")
      .update({ include_salary_costs: parsed.data.includeSalaryCosts, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.siteId)
      .eq("organisation_id", profile.organisationId)
      .select("name")
      .single();
    if (error || !site) return { status: "error", message: "The kitchen salary setting could not be changed." };
    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "site.salary_cost_setting_changed",
      entity_type: "site",
      entity_id: parsed.data.siteId,
      detail: { include_salary_costs: parsed.data.includeSalaryCosts },
    });
    revalidateSalaryRoutes();
    return { status: "success", message: `${site.name} will ${parsed.data.includeSalaryCosts ? "include" : "exclude"} salary accruals in staff cost.` };
  } catch {
    return { status: "error", message: "The server-side database connection is unavailable." };
  }
}

function revalidateSalaryRoutes() {
  for (const path of ["/costs", "/costs/salaries", "/reports", "/reports/new", "/summary", "/dashboard", "/insights"]) revalidatePath(path);
}

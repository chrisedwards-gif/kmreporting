"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SiteActionState } from "@/app/actions/sites";

const siteLifecycleSchema = z.object({
  siteId: z.uuid(),
  intent: z.enum(["archive", "restore"]),
  reportingStartDate: z.iso.date().optional(),
});

const deleteSiteSchema = z.object({
  siteId: z.uuid(),
  confirmationCode: z.string().trim().min(2).max(24),
});

export async function setSiteLifecycle(_previousState: SiteActionState, formData: FormData): Promise<SiteActionState> {
  const parsed = siteLifecycleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the kitchen lifecycle details." };
  const profile = await requireRole(["admin"]);
  try {
    const admin = createAdminClient();
    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("id, name, active, reporting_start_date")
      .eq("id", parsed.data.siteId)
      .eq("organisation_id", profile.organisationId)
      .maybeSingle();
    if (siteError || !site) return { status: "error", message: "That kitchen could not be found." };

    const restoring = parsed.data.intent === "restore";
    if (restoring === site.active) return { status: "success", message: restoring ? "Kitchen is already active." : "Kitchen is already archived." };

    const restoreDate = parsed.data.reportingStartDate ?? getCurrentReportingWeek().start;
    if (restoring && new Date(`${restoreDate}T00:00:00Z`).getUTCDay() !== 0) {
      return { status: "error", message: "The restored reporting week must start on a Sunday." };
    }
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await admin.from("sites").update({
      active: restoring,
      reporting_start_date: restoring ? restoreDate : site.reporting_start_date,
      reporting_end_date: restoring ? null : today,
      updated_at: new Date().toISOString(),
    }).eq("id", site.id).eq("organisation_id", profile.organisationId);
    if (error) return { status: "error", message: "The kitchen lifecycle could not be changed." };

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: restoring ? "site.restored" : "site.archived",
      entity_type: "site",
      entity_id: site.id,
      detail: restoring ? { reporting_start_date: restoreDate } : { reporting_end_date: today },
    });
    revalidateSiteRoutes();
    return {
      status: "success",
      message: restoring
        ? `${site.name} is active again from the selected reporting week.`
        : `${site.name} is archived. All reports, checks, 1-1s and assignments have been preserved.`,
    };
  } catch {
    return { status: "error", message: "The kitchen lifecycle could not be changed because the server-side database connection is unavailable." };
  }
}

export async function deleteUnusedSite(_previousState: SiteActionState, formData: FormData): Promise<SiteActionState> {
  const parsed = deleteSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter the kitchen code to confirm deletion." };
  await requireRole(["admin"]);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };
  const { data, error } = await supabase.rpc("delete_unused_site", {
    target_site: parsed.data.siteId,
    confirmation_code: parsed.data.confirmationCode,
  });
  if (error) {
    if (error.message.includes("linked history")) return { status: "error", message: "This kitchen now has linked history and cannot be deleted. Archive it instead." };
    if (error.message.includes("confirmation code")) return { status: "error", message: "The confirmation code does not match this kitchen." };
    if (error.message.includes("archive kitchen")) return { status: "error", message: "Archive the kitchen before permanently deleting it." };
    return { status: "error", message: "The unused kitchen could not be permanently deleted." };
  }
  revalidateSiteRoutes();
  const deletedName = typeof data === "object" && data && "name" in data ? String(data.name) : "Kitchen";
  return { status: "success", message: `${deletedName} was permanently deleted.` };
}

function revalidateSiteRoutes() {
  for (const path of ["/settings/sites", "/dashboard", "/reports", "/reports/new", "/approvals", "/summary", "/checks", "/sops", "/training", "/product-development", "/calendar", "/insights"]) revalidatePath(path);
}

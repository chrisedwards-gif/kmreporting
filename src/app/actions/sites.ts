"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { getRequestOrigin } from "@/lib/http";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SiteActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const siteSchema = z.object({
  name: z.string().trim().min(2, "Enter a kitchen name.").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, "Use 2–24 capital letters, numbers or hyphens for the site code."),
  foodCostTarget: z.coerce.number().min(0).max(100),
  labourTarget: z.coerce.number().min(0).max(100),
  wasteTarget: z.coerce.number().min(0).max(100),
});

const createSiteSchema = siteSchema.extend({
  reportingStartDate: z.iso.date().refine((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 0, "The first reporting week must start on a Sunday."),
});

const updateSiteSchema = siteSchema.extend({
  siteId: z.uuid(),
  active: z.enum(["true", "false"]),
});

const assignManagerSchema = z.object({
  siteId: z.uuid(),
  fullName: z.string().trim().min(2, "Enter the manager's name.").max(120),
  email: z.email("Enter a valid work email address.").transform((value) => value.toLowerCase()),
  effectiveFrom: z.iso.date().refine((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 0, "The manager assignment must start on a Sunday."),
});

export async function createSite(
  _previousState: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const parsed = createSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the kitchen details." };
  }

  const profile = await requireRole(["admin"]);

  try {
    const admin = createAdminClient();
    const { data: createdSite, error } = await admin.from("sites").insert({
      organisation_id: profile.organisationId,
      name: parsed.data.name,
      code: parsed.data.code,
      active: true,
      reporting_start_date: parsed.data.reportingStartDate,
      food_cost_target: parsed.data.foodCostTarget,
      labour_target: parsed.data.labourTarget,
      waste_target: parsed.data.wasteTarget,
    }).select("id").single();

    if (error?.code === "23505") return { status: "error", message: "That site code is already in use." };
    if (error || !createdSite) return { status: "error", message: "The kitchen could not be created. Please try again." };

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "site.created",
      entity_type: "site",
      entity_id: createdSite.id,
      detail: { code: parsed.data.code },
    });
  } catch {
    return { status: "error", message: "The kitchen could not be created because the server-side database connection is unavailable." };
  }

  revalidatePath("/settings/sites");
  revalidatePath("/reports/new");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  return { status: "success", message: `${parsed.data.name} is ready for weekly reporting.` };
}

export async function updateSite(
  _previousState: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const parsed = updateSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the kitchen details." };
  const profile = await requireRole(["admin"]);

  try {
    const admin = createAdminClient();
    const { data: currentSite, error: currentError } = await admin
      .from("sites")
      .select("id, active, reporting_start_date, reporting_end_date")
      .eq("id", parsed.data.siteId)
      .eq("organisation_id", profile.organisationId)
      .maybeSingle();
    if (currentError || !currentSite) return { status: "error", message: "That kitchen could not be found." };

    const nextActive = parsed.data.active === "true";
    const reactivating = nextActive && !currentSite.active;
    const deactivating = !nextActive && currentSite.active;
    const today = new Date().toISOString().slice(0, 10);
    const reportingStartDate = reactivating ? getCurrentReportingWeek().start : currentSite.reporting_start_date;
    const reportingEndDate = nextActive
      ? null
      : deactivating
        ? today
        : currentSite.reporting_end_date ?? today;

    const { data: updatedSite, error } = await admin.from("sites").update({
      name: parsed.data.name,
      code: parsed.data.code,
      active: nextActive,
      reporting_start_date: reportingStartDate,
      reporting_end_date: reportingEndDate,
      food_cost_target: parsed.data.foodCostTarget,
      labour_target: parsed.data.labourTarget,
      waste_target: parsed.data.wasteTarget,
      updated_at: new Date().toISOString(),
    }).eq("id", parsed.data.siteId).eq("organisation_id", profile.organisationId).select("id").maybeSingle();

    if (error?.code === "23505") return { status: "error", message: "That site code is already in use." };
    if (error || !updatedSite) return { status: "error", message: "The kitchen settings could not be saved." };

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "site.updated",
      entity_type: "site",
      entity_id: parsed.data.siteId,
      detail: {
        active: nextActive,
        code: parsed.data.code,
        reporting_start_date: reportingStartDate,
        reporting_end_date: reportingEndDate,
      },
    });

    revalidatePath("/settings/sites");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath("/reports/new");
    revalidatePath("/approvals");
    revalidatePath("/summary");
    return {
      status: "success",
      message: reactivating
        ? "Kitchen reactivated from the current reporting week."
        : deactivating
          ? "Kitchen deactivated. Historical reports and manager records were preserved."
          : "Kitchen settings saved.",
    };
  } catch {
    return { status: "error", message: "The kitchen settings could not be saved because the server-side database connection is unavailable." };
  }
}

export async function assignSiteManager(
  _previousState: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const parsed = assignManagerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the manager details." };
  const profile = await requireRole(["admin"]);

  try {
    const admin = createAdminClient();
    const { data: site } = await admin.from("sites").select("id").eq("id", parsed.data.siteId).eq("organisation_id", profile.organisationId).maybeSingle();
    if (!site) return { status: "error", message: "That kitchen is outside your organisation." };

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, role")
      .eq("organisation_id", profile.organisationId)
      .eq("notification_email", parsed.data.email)
      .maybeSingle();

    let userId = existingProfile?.id;
    let invited = false;
    if (existingProfile && existingProfile.role !== "kitchen_manager") {
      return { status: "error", message: "That email already belongs to a different application role." };
    }

    if (!userId) {
      const origin = await getRequestOrigin();
      const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
        data: { full_name: parsed.data.fullName },
        ...(origin ? { redirectTo: `${origin}/auth/callback?next=/auth/set-password` } : {}),
      });
      if (invitationError || !invitation.user) {
        return { status: "error", message: "The invitation could not be sent. Check whether this email already has an Auth account." };
      }
      userId = invitation.user.id;
      invited = true;
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      organisation_id: profile.organisationId,
      full_name: parsed.data.fullName,
      notification_email: parsed.data.email,
      role: "kitchen_manager",
      active: true,
    });
    if (profileError) return { status: "error", message: "The login exists, but its canonical application profile could not be saved." };

    const supabase = await createServerSupabaseClient();
    if (!supabase) return { status: "error", message: "The database connection is unavailable." };
    const { error: assignmentError } = await supabase.rpc("assign_primary_site_manager", {
      target_site: parsed.data.siteId,
      target_profile: userId,
      effective_from: parsed.data.effectiveFrom,
    });
    if (assignmentError) {
      const message = assignmentError.message.includes("assign_primary_site_manager")
        ? "Apply migration 012 before assigning the primary manager."
        : assignmentError.message;
      return { status: "error", message };
    }

    revalidatePath("/settings/sites");
    revalidatePath("/reports/new");
    revalidatePath("/one-to-ones");
    return {
      status: "success",
      message: invited
        ? "Manager invited and set as the primary KM. Their login UUID now owns future site 1-1s."
        : "Existing manager profile set as the primary KM. Previous assignment history was preserved.",
    };
  } catch {
    return { status: "error", message: "Manager invitations require the server-side Supabase secret in Netlify." };
  }
}

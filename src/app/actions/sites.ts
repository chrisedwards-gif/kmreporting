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
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: createdSite, error } = await supabase.from("sites").insert({
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
  if (error) return { status: "error", message: "The kitchen could not be created. Please try again." };
  try {
    await createAdminClient().from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "site.created", entity_type: "site", entity_id: createdSite.id, detail: { code: parsed.data.code } });
  } catch { /* Site creation remains RLS-protected if audit delivery is temporarily unavailable. */ }

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
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: "The database connection is unavailable." };

  const { data: currentSite, error: currentError } = await supabase
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

  const { data: updatedSite, error } = await supabase.from("sites").update({
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
  try {
    await createAdminClient().from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "site.updated",
      entity_type: "site",
      entity_id: parsed.data.siteId,
      detail: { active: nextActive, code: parsed.data.code, reporting_start_date: reportingStartDate, reporting_end_date: reportingEndDate },
    });
  } catch { /* The primary RLS-protected update has already succeeded. */ }

  revalidatePath("/settings/sites");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/reports/new");
  revalidatePath("/approvals");
  revalidatePath("/summary");
  return { status: "success", message: reactivating ? "Kitchen reactivated from the current reporting week." : "Kitchen settings saved." };
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
      const { error: profileError } = await admin.from("profiles").upsert({
        id: userId,
        organisation_id: profile.organisationId,
        full_name: parsed.data.fullName,
        notification_email: parsed.data.email,
        role: "kitchen_manager",
        active: true,
      });
      if (profileError) return { status: "error", message: "The account was invited, but its application profile could not be created." };
    }

    const { error: membershipError } = await admin.from("site_memberships").upsert({
      user_id: userId,
      site_id: parsed.data.siteId,
      can_submit: true,
    });
    if (membershipError) return { status: "error", message: "The manager account exists, but site access could not be assigned." };

    await admin.from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "site.manager_assigned", entity_type: "site", entity_id: parsed.data.siteId, detail: { user_id: userId } });

    revalidatePath("/settings/sites");
    revalidatePath("/reports/new");
    return { status: "success", message: invited ? "Manager invited and assigned to this kitchen." : "Existing manager assigned to this kitchen." };
  } catch {
    return { status: "error", message: "Manager invitations require the server-side Supabase secret in Vercel." };
  }
}

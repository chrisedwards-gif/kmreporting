"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";

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
  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
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
    reporting_start_date: getLatestCompletedReportingWeek().start,
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

  const { error } = await supabase.from("sites").update({
    name: parsed.data.name,
    code: parsed.data.code,
    active: parsed.data.active === "true",
    reporting_end_date: parsed.data.active === "true" ? null : new Date().toISOString().slice(0, 10),
    food_cost_target: parsed.data.foodCostTarget,
    labour_target: parsed.data.labourTarget,
    waste_target: parsed.data.wasteTarget,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.siteId).eq("organisation_id", profile.organisationId);

  if (error?.code === "23505") return { status: "error", message: "That site code is already in use." };
  if (error) return { status: "error", message: "The kitchen settings could not be saved." };
  try {
    await createAdminClient().from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "site.updated", entity_type: "site", entity_id: parsed.data.siteId, detail: { active: parsed.data.active === "true", code: parsed.data.code } });
  } catch { /* The primary RLS-protected update has already succeeded. */ }
  revalidatePath("/settings/sites");
  revalidatePath("/dashboard");
  return { status: "success", message: "Kitchen settings saved." };
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
      const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
        data: { full_name: parsed.data.fullName },
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

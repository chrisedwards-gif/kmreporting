"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { getRequestOrigin } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export type ManagerActionState = { status: "idle" | "success" | "error"; message: string };

type KitchenAssignmentResult = {
  error?: string;
  siteName?: string;
  assistant?: boolean;
};

const managerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the manager's name.").max(120),
  email: z.email("Enter a valid work email.").transform((value) => value.toLowerCase()),
  roleTitle: z.string().trim().min(2).max(120).default("Kitchen Manager"),
  siteId: z.union([z.string().uuid(), z.literal("")]).default(""),
  employmentStartDate: z.string().default(""),
  probationEndDate: z.string().default(""),
  focusAreas: z.string().max(2000).default(""),
});

const updateSchema = z.object({
  profileId: z.string().uuid(),
  roleTitle: z.string().trim().min(2).max(120).default("Kitchen Manager"),
  employmentStartDate: z.string().default(""),
  probationEndDate: z.string().default(""),
  focusAreas: z.string().max(2000).default(""),
  active: z.enum(["true", "false"]),
});

const focusAreasFromText = (value: string) => [...new Set(value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))].slice(0, 30);

function reportingWeekStart(value?: string) {
  const input = value || new Date().toISOString().slice(0, 10);
  const date = new Date(`${input}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

async function assignPersonToKitchen({
  admin,
  organisationId,
  actorId,
  profileId,
  siteId,
  roleTitle,
  employmentStartDate,
}: {
  admin: ReturnType<typeof createAdminClient>;
  organisationId: string;
  actorId: string;
  profileId: string;
  siteId: string;
  roleTitle: string;
  employmentStartDate: string;
}): Promise<KitchenAssignmentResult> {
  const { data: site, error: siteError } = await admin
    .from("sites")
    .select("id, name")
    .eq("id", siteId)
    .eq("organisation_id", organisationId)
    .eq("active", true)
    .maybeSingle();
  if (siteError || !site) return { error: "That kitchen could not be found." };

  const { error: membershipError } = await admin
    .from("site_memberships")
    .upsert({ user_id: profileId, site_id: siteId, can_submit: true }, { onConflict: "user_id,site_id" });
  if (membershipError) return { error: "The person was created, but kitchen reporting access could not be saved." };

  const isAssistant = /assistant/i.test(roleTitle);
  const { data: existingAssignment } = await admin
    .from("site_manager_assignments")
    .select("id, assignment_role")
    .eq("site_id", siteId)
    .eq("manager_profile_id", profileId)
    .is("ends_on", null)
    .maybeSingle();

  if (!existingAssignment) {
    let assignmentRole: "primary" | "assistant" = "assistant";
    if (!isAssistant) {
      const { data: currentPrimary } = await admin
        .from("site_manager_assignments")
        .select("id")
        .eq("site_id", siteId)
        .eq("assignment_role", "primary")
        .is("ends_on", null)
        .maybeSingle();
      assignmentRole = currentPrimary ? "assistant" : "primary";
    }

    const { error: assignmentError } = await admin.from("site_manager_assignments").insert({
      organisation_id: organisationId,
      site_id: siteId,
      manager_profile_id: profileId,
      starts_on: reportingWeekStart(employmentStartDate),
      ends_on: null,
      assigned_by: actorId,
      assignment_role: assignmentRole,
    });
    if (assignmentError) {
      return { error: assignmentError.message.includes("assignment_role") ? "Apply the assistant-manager assignment migration before assigning this person." : assignmentError.message };
    }
  }

  return { siteName: site.name, assistant: isAssistant };
}

export async function createManager(
  _previous: ManagerActionState,
  formData: FormData,
): Promise<ManagerActionState> {
  const profile = await requireRole(["admin"]);
  const parsed = managerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the manager details." };

  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("profiles")
      .select("id, role, full_name, notification_email")
      .eq("organisation_id", profile.organisationId)
      .eq("notification_email", parsed.data.email)
      .maybeSingle();
    if (existing && existing.role !== "kitchen_manager") {
      return { status: "error", message: "That email already belongs to a different application role." };
    }

    let profileId = existing?.id;
    let invited = false;
    if (existing && profileId) {
      const { data: authRecord, error: authError } = await admin.auth.admin.getUserById(profileId);
      const authEmail = authRecord.user?.email?.toLowerCase() ?? "";
      if (authError || !authRecord.user || authEmail !== parsed.data.email) {
        return { status: "error", message: "This profile is not linked to the same login email in Supabase Auth. It has been left unchanged to protect the existing person's identity." };
      }
      if ((existing.full_name ?? "").trim().toLowerCase() !== parsed.data.fullName.trim().toLowerCase()) {
        return { status: "error", message: `That email already belongs to ${existing.full_name}. Create a new person with their own email instead of reusing an existing login.` };
      }
    } else {
      const origin = await getRequestOrigin();
      const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
        data: { full_name: parsed.data.fullName },
        ...(origin ? { redirectTo: `${origin}/auth/callback?next=/auth/set-password` } : {}),
      });
      if (inviteError || !invitation.user) {
        return { status: "error", message: "The account invitation could not be created. Check whether that email already exists in Supabase Auth." };
      }
      profileId = invitation.user.id;
      invited = true;
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: profileId,
      organisation_id: profile.organisationId,
      full_name: parsed.data.fullName,
      notification_email: parsed.data.email,
      role: "kitchen_manager",
      active: true,
    });
    if (profileError) return { status: "error", message: "The manager login exists, but the canonical profile could not be saved." };

    const { error: detailError } = await admin.from("manager_details").upsert({
      profile_id: profileId,
      organisation_id: profile.organisationId,
      role_title: parsed.data.roleTitle,
      employment_start_date: parsed.data.employmentStartDate || null,
      probation_end_date: parsed.data.probationEndDate || null,
      focus_areas: focusAreasFromText(parsed.data.focusAreas),
      updated_at: new Date().toISOString(),
    });
    if (detailError) return { status: "error", message: "The profile was created, but its employment details could not be saved." };

    let kitchenMessage = "";
    if (parsed.data.siteId) {
      const assignment = await assignPersonToKitchen({
        admin,
        organisationId: profile.organisationId,
        actorId: profile.id,
        profileId,
        siteId: parsed.data.siteId,
        roleTitle: parsed.data.roleTitle,
        employmentStartDate: parsed.data.employmentStartDate,
      });
      if (assignment.error) return { status: "error", message: assignment.error };
      kitchenMessage = ` ${parsed.data.fullName} now has ${assignment.siteName ?? "kitchen"} reporting access${assignment.assistant ? " and their own weekly 1-1 assignment" : ""}.`;
    }

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "manager.created",
      entity_type: "profile",
      entity_id: profileId,
      detail: { invited, email: parsed.data.email, roleTitle: parsed.data.roleTitle, siteId: parsed.data.siteId || null },
    });
    for (const path of ["/people", "/performance/managers", "/one-to-ones", "/settings/sites", "/reports/new"]) revalidatePath(path);
    return { status: "success", message: `${invited ? "Person created and invitation sent." : "Existing person matched this login."}${kitchenMessage}` };
  } catch {
    return { status: "error", message: "People administration requires the server-side Supabase secret in Netlify." };
  }
}

export async function updateManager(
  _previous: ManagerActionState,
  formData: FormData,
): Promise<ManagerActionState> {
  const actor = await requireRole(["admin"]);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the manager details." };

  try {
    const admin = createAdminClient();
    const { data: canonical, error: canonicalError } = await admin
      .from("profiles")
      .select("id, full_name, notification_email")
      .eq("id", parsed.data.profileId)
      .eq("organisation_id", actor.organisationId)
      .maybeSingle();
    if (canonicalError || !canonical) return { status: "error", message: "The canonical person record could not be found." };

    const { data: authRecord, error: authError } = await admin.auth.admin.getUserById(parsed.data.profileId);
    if (authError || !authRecord.user || authRecord.user.email?.toLowerCase() !== canonical.notification_email?.toLowerCase()) {
      return { status: "error", message: "This person's app profile and login identity do not match. No changes were made." };
    }

    if (parsed.data.active === "false") {
      const { data: currentAssignments } = await admin
        .from("site_manager_assignments")
        .select("id")
        .eq("manager_profile_id", parsed.data.profileId)
        .is("ends_on", null)
        .limit(1);
      if (currentAssignments?.length) return { status: "error", message: "End this person's current kitchen assignment before deactivating their account." };
    }

    const { error: profileError } = await admin.from("profiles").update({ active: parsed.data.active === "true" }).eq("id", parsed.data.profileId).eq("organisation_id", actor.organisationId);
    if (profileError) return { status: "error", message: "The person profile could not be updated." };

    const { error: detailError } = await admin.from("manager_details").upsert({
      profile_id: parsed.data.profileId,
      organisation_id: actor.organisationId,
      role_title: parsed.data.roleTitle,
      employment_start_date: parsed.data.employmentStartDate || null,
      probation_end_date: parsed.data.probationEndDate || null,
      focus_areas: focusAreasFromText(parsed.data.focusAreas),
      updated_at: new Date().toISOString(),
    });
    if (detailError) return { status: "error", message: "The employment details could not be updated." };

    await admin.from("audit_log").insert({ organisation_id: actor.organisationId, actor_id: actor.id, action: "manager.updated", entity_type: "profile", entity_id: parsed.data.profileId, detail: { active: parsed.data.active === "true", roleTitle: parsed.data.roleTitle } });
    for (const path of ["/people", "/performance/managers", "/performance/probation", "/one-to-ones"]) revalidatePath(path);
    return { status: "success", message: "Employment and performance details saved against the canonical login UUID." };
  } catch {
    return { status: "error", message: "The person details could not be updated." };
  }
}

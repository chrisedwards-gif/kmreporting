"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { getRequestOrigin } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReportingAccessState = { status: "idle" | "success" | "error"; message: string };

const viewerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the person's name.").max(120),
  email: z.email("Enter a valid work email.").transform((value) => value.toLowerCase()),
});

const updateViewerSchema = viewerSchema.extend({
  profileId: z.uuid(),
  active: z.enum(["true", "false"]),
});

export async function createReportingViewer(
  _previous: ReportingAccessState,
  formData: FormData,
): Promise<ReportingAccessState> {
  const actor = await requireActualRole(["admin"]);
  const parsed = viewerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the account details." };

  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("profiles")
      .select("id, role")
      .eq("organisation_id", actor.organisationId)
      .eq("notification_email", parsed.data.email)
      .maybeSingle();
    if (existing && existing.role !== "viewer") {
      return { status: "error", message: "That email already belongs to a different application role." };
    }

    let profileId = existing?.id;
    let invited = false;
    if (!profileId) {
      const origin = await getRequestOrigin();
      const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
        data: { full_name: parsed.data.fullName },
        ...(origin ? { redirectTo: `${origin}/auth/confirm?type=invite&next=/auth/set-password` } : {}),
      });
      if (inviteError || !invitation.user) {
        return { status: "error", message: "The reporting invitation could not be created. Check whether that email already exists in Supabase Auth." };
      }
      profileId = invitation.user.id;
      invited = true;
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: profileId,
      organisation_id: actor.organisationId,
      full_name: parsed.data.fullName,
      notification_email: parsed.data.email,
      role: "viewer",
      active: true,
    });
    if (profileError) return { status: "error", message: "The login exists, but its reporting profile could not be saved." };

    await admin.from("audit_log").insert({
      organisation_id: actor.organisationId,
      actor_id: actor.id,
      action: "reporting_viewer.created",
      entity_type: "profile",
      entity_id: profileId,
      detail: { invited, email: parsed.data.email },
    });
    revalidatePath("/performance/managers");
    return { status: "success", message: invited ? "Reporting viewer created and invitation sent." : "Existing reporting viewer profile updated." };
  } catch {
    return { status: "error", message: "Reporting access administration requires the server-side Supabase secret." };
  }
}

export async function updateReportingViewer(
  _previous: ReportingAccessState,
  formData: FormData,
): Promise<ReportingAccessState> {
  const actor = await requireActualRole(["admin"]);
  const parsed = updateViewerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the account details." };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").update({
      full_name: parsed.data.fullName,
      notification_email: parsed.data.email,
      active: parsed.data.active === "true",
      updated_at: new Date().toISOString(),
    }).eq("id", parsed.data.profileId).eq("organisation_id", actor.organisationId).eq("role", "viewer");
    if (error) return { status: "error", message: "The reporting viewer could not be updated." };

    await admin.from("audit_log").insert({
      organisation_id: actor.organisationId,
      actor_id: actor.id,
      action: "reporting_viewer.updated",
      entity_type: "profile",
      entity_id: parsed.data.profileId,
      detail: { active: parsed.data.active === "true" },
    });
    revalidatePath("/performance/managers");
    return { status: "success", message: "Reporting viewer access saved." };
  } catch {
    return { status: "error", message: "The reporting viewer could not be updated." };
  }
}

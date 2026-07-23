"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaTeamActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const staffSchema = z.object({
  id: z.string().optional().default(""),
  appProfileId: z.string().uuid().or(z.literal("")).optional().default(""),
  siteId: z.string().min(1),
  employeeRef: z.string().trim().min(1).max(120),
  rotacloudUserId: z.string().trim().optional().default(""),
  staffName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().min(2).max(120),
  roleRank: z.coerce.number().int().min(0).max(9999),
  displayOrder: z.coerce.number().int().min(0).max(999999),
  skills: z.string().trim().max(500).optional().default(""),
  minimumWeeklyHours: z.coerce.number().min(0).max(100),
  targetWeeklyHours: z.coerce.number().min(0).max(100),
  maximumWeeklyHours: z.coerce.number().min(0).max(100),
  minimumShiftHours: z.coerce.number().min(1).max(12),
  maximumShiftHours: z.coerce.number().min(2).max(16),
  maximumConsecutiveDays: z.coerce.number().int().min(1).max(7),
  preferredStart: z.string().optional().default(""),
  preferredEnd: z.string().optional().default(""),
  payBasis: z.enum(["hourly", "salaried"]),
  hourlyRate: z.string().optional().default(""),
  annualSalary: z.string().optional().default(""),
  contractedWeeklyHours: z.string().optional().default(""),
  employerNiRate: z.coerce.number().min(0).max(100),
  pensionRate: z.coerce.number().min(0).max(100),
  otherOncostRate: z.coerce.number().min(0).max(100),
  costAllocationPct: z.coerce.number().min(0).max(100),
  validFrom: z.iso.date(),
  notes: z.string().trim().max(1000).optional().default(""),
});

const orderSchema = z.object({
  ordering: z.string().min(2),
});

const orderPayloadSchema = z.array(z.object({
  id: z.string().uuid(),
  roleRank: z.number().int().min(0).max(9999),
  displayOrder: z.number().int().min(0).max(999999),
})).min(1).max(500);

export async function saveRotaStaffProfileV2(
  _previous: RotaTeamActionState,
  formData: FormData,
): Promise<RotaTeamActionState> {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the staff profile." };
  const values = parsed.data;

  if (values.minimumWeeklyHours > values.targetWeeklyHours || values.targetWeeklyHours > values.maximumWeeklyHours) {
    return { status: "error", message: "Weekly hours must run from minimum to target to maximum." };
  }
  if (values.minimumShiftHours > values.maximumShiftHours) {
    return { status: "error", message: "Minimum shift length cannot exceed maximum shift length." };
  }

  const hourlyRate = Number(values.hourlyRate);
  const annualSalary = Number(values.annualSalary);
  const contractedHours = Number(values.contractedWeeklyHours);
  if (values.payBasis === "hourly" && !(hourlyRate > 0)) return { status: "error", message: "Enter the hourly pay rate." };
  if (values.payBasis === "salaried" && (!(annualSalary > 0) || !(contractedHours > 0))) {
    return { status: "error", message: "Enter annual salary and contracted weekly hours." };
  }

  const organisationWide = formData.get("organisationWide") === "true";
  const primarySite = formData.get("primarySite") === "true";
  const payload = {
    id: values.id,
    appProfileId: values.appProfileId,
    siteId: values.siteId,
    employeeRef: values.employeeRef,
    rotacloudUserId: values.rotacloudUserId,
    staffName: values.staffName,
    roleTitle: values.roleTitle,
    roleRank: values.roleRank,
    displayOrder: values.displayOrder,
    organisationWide,
    skills: values.skills.split(",").map((skill) => skill.trim().toLowerCase()).filter(Boolean),
    minimumWeeklyHours: values.minimumWeeklyHours,
    targetWeeklyHours: values.targetWeeklyHours,
    maximumWeeklyHours: values.maximumWeeklyHours,
    minimumShiftMinutes: Math.round(values.minimumShiftHours * 60),
    maximumShiftMinutes: Math.round(values.maximumShiftHours * 60),
    maximumConsecutiveDays: values.maximumConsecutiveDays,
    preferredDays: formData.getAll("preferredDays").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    preferredStart: values.preferredStart,
    preferredEnd: values.preferredEnd,
    payBasis: values.payBasis,
    hourlyRate: values.payBasis === "hourly" ? hourlyRate : null,
    annualSalary: values.payBasis === "salaried" ? annualSalary : null,
    contractedWeeklyHours: values.payBasis === "salaried" ? contractedHours : null,
    employerNiRate: values.employerNiRate / 100,
    pensionRate: values.pensionRate / 100,
    otherOncostRate: values.otherOncostRate / 100,
    costAllocationPct: values.costAllocationPct,
    primarySite,
    active: true,
    validFrom: values.validFrom,
    notes: values.notes,
    source: "manual",
  };

  if (environment.isDemo) return { status: "success", message: "Demo profile validated. Live workspaces save the UUID link and private employment details." };

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_rota_staff_profile_private", {
      target_organisation: profile.organisationId,
      target_actor: profile.id,
      payload,
    });
    if (error) {
      console.error("rota staff v2 save failed", { code: error.code, message: error.message });
      return { status: "error", message: "The linked staff profile could not be saved." };
    }
    revalidatePath("/rotas");
    revalidatePath("/rotas/team");
    return { status: "success", message: `${values.staffName} is linked and available to the rota.` };
  } catch {
    return { status: "error", message: "The secure rota team service is unavailable." };
  }
}

export async function saveRotaDisplayOrder(
  _previous: RotaTeamActionState,
  formData: FormData,
): Promise<RotaTeamActionState> {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "The rota order is incomplete." };

  let ordering: z.infer<typeof orderPayloadSchema>;
  try {
    ordering = orderPayloadSchema.parse(JSON.parse(parsed.data.ordering));
  } catch {
    return { status: "error", message: "The rota order could not be read." };
  }

  if (environment.isDemo) return { status: "success", message: "Demo display order saved for this session." };

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_rota_staff_order_private", {
      target_organisation: profile.organisationId,
      target_actor: profile.id,
      payload: ordering,
    });
    if (error) {
      console.error("rota order save failed", { code: error.code, message: error.message });
      return { status: "error", message: "The rota display order could not be saved." };
    }
    revalidatePath("/rotas");
    revalidatePath("/rotas/team");
    return { status: "success", message: "Rota role and people order saved." };
  } catch {
    return { status: "error", message: "The secure ordering service is unavailable." };
  }
}

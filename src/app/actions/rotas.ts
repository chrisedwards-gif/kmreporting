"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActualRole, requireSessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";
import { environment } from "@/lib/env";
import { buildRotaPlan } from "@/lib/rota/planner";
import { getRotaCloudDirectory, isRotaCloudConfigured } from "@/lib/rota/rotacloud";
import type { RotaPlan } from "@/lib/rota/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaActionState = { status: "idle" | "success" | "error"; message: string };

const generateSchema = z.object({
  siteId: z.string().min(1),
  weekStart: z.iso.date(),
});

const eventSchema = z.object({
  siteId: z.string().min(1),
  eventDate: z.iso.date(),
  title: z.string().trim().min(2).max(160),
  salesUpliftPct: z.coerce.number().min(-90).max(500),
  notes: z.string().trim().max(1000).optional().default(""),
});

const staffSchema = z.object({
  id: z.string().optional().default(""),
  siteId: z.string().min(1),
  employeeRef: z.string().trim().min(1).max(120),
  rotacloudUserId: z.string().trim().optional().default(""),
  staffName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().min(2).max(120),
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
  costAllocationPct: z.coerce.number().positive().max(100),
  validFrom: z.iso.date(),
  notes: z.string().trim().max(1000).optional().default(""),
});

const configurationSchema = z.object({
  siteId: z.string().min(1),
  forecastWeeks: z.coerce.number().int().min(4).max(26),
  minimumHistoryWeeks: z.coerce.number().int().min(2).max(12),
  intervalMinutes: z.coerce.number().refine((value) => [15, 30, 60].includes(value)),
  salesPerLabourHourTarget: z.coerce.number().min(20).max(500),
  minimumRestHours: z.coerce.number().min(8).max(24),
  demandMode: z.enum(["automatic", "manual"]),
  demandSlots: z.string().min(1),
});

export async function generateRotaSuggestion(_previous: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a kitchen and a Monday week start." };
  const profile = await requireSessionProfile();
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) return { status: "error", message: "Your role cannot generate rota suggestions." };
  if (!scopeContainsSite(profile.siteScopeIds, parsed.data.siteId)) return { status: "error", message: "That kitchen is outside your workspace." };

  const workspace = await getRotaPlanningWorkspace({ profile, requestedSiteId: parsed.data.siteId, requestedWeekStart: parsed.data.weekStart });
  if (!workspace.selectedSite || workspace.error) return { status: "error", message: workspace.error ?? "The rota workspace is unavailable." };
  if (workspace.staff.length < 2) return { status: "error", message: "Add at least two active staff profiles before generating a rota." };
  if (!workspace.history.length) return { status: "error", message: "No dated sales history is available yet. Import daily EPOS sales before trusting a rota suggestion." };

  const plan = buildRotaPlan({
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

  if (environment.isDemo) return { status: "success", message: "Demo suggestion recalculated. Live workspaces save a versioned, audited plan." };
  try {
    const admin = createAdminClient();
    const safePlan = stripPrivateShiftCosts(plan);
    const { error } = await admin.rpc("save_rota_plan_private", {
      target_organisation: profile.organisationId,
      target_site: parsed.data.siteId,
      target_actor: profile.id,
      payload: safePlan,
    });
    if (error) {
      console.error("rota plan save failed", { code: error.code, message: error.message, siteId: parsed.data.siteId });
      return { status: "error", message: "The rota was calculated but could not be saved atomically. No partial plan was retained." };
    }
    revalidatePath("/rotas");
    return { status: "success", message: `Rota suggestion generated for ${workspace.selectedSite.name}. Review every warning before copying it to RotaCloud.` };
  } catch {
    return { status: "error", message: "The secure rota save service is unavailable." };
  }
}

export async function saveRotaForecastEvent(_previous: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the event details." };
  const profile = await requireSessionProfile();
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole) || !scopeContainsSite(profile.siteScopeIds, parsed.data.siteId)) return { status: "error", message: "That event is outside your kitchen scope." };
  if (environment.isDemo) return { status: "success", message: "Demo event noted. Live workspaces save this uplift in the audit trail." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("rota_forecast_events").upsert({
      organisation_id: profile.organisationId,
      site_id: parsed.data.siteId,
      event_date: parsed.data.eventDate,
      title: parsed.data.title,
      sales_uplift_pct: parsed.data.salesUpliftPct,
      notes: parsed.data.notes,
      source: "manual",
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "site_id,event_date,title" });
    if (error) return { status: "error", message: "The forecast event could not be saved." };
    await admin.from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "rota.forecast_event_saved", entity_type: "site", entity_id: parsed.data.siteId, detail: { event_date: parsed.data.eventDate, title: parsed.data.title, sales_uplift_pct: parsed.data.salesUpliftPct } });
    revalidatePath("/rotas");
    return { status: "success", message: "Event saved. Generate the rota again to apply its sales uplift." };
  } catch {
    return { status: "error", message: "The forecast event service is unavailable." };
  }
}

export async function saveRotaStaffProfile(_previous: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the staff profile." };
  const values = parsed.data;
  if (values.minimumWeeklyHours > values.targetWeeklyHours || values.targetWeeklyHours > values.maximumWeeklyHours) return { status: "error", message: "Weekly hours must run from minimum to target to maximum." };
  if (values.minimumShiftHours > values.maximumShiftHours) return { status: "error", message: "Minimum shift length cannot exceed maximum shift length." };
  const hourlyRate = Number(values.hourlyRate);
  const annualSalary = Number(values.annualSalary);
  const contractedHours = Number(values.contractedWeeklyHours);
  if (values.payBasis === "hourly" && !(hourlyRate > 0)) return { status: "error", message: "Enter the hourly pay rate." };
  if (values.payBasis === "salaried" && (!(annualSalary > 0) || !(contractedHours > 0))) return { status: "error", message: "Enter annual salary and contracted weekly hours." };
  if (environment.isDemo) return { status: "success", message: "Demo profile validated. Live workspaces save this in the private payroll schema." };

  const payload = {
    id: values.id,
    siteId: values.siteId,
    employeeRef: values.employeeRef,
    rotacloudUserId: values.rotacloudUserId,
    staffName: values.staffName,
    roleTitle: values.roleTitle,
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
    primarySite: true,
    active: true,
    validFrom: values.validFrom,
    notes: values.notes,
    source: "manual",
  };
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_rota_staff_profile_private", { target_organisation: profile.organisationId, target_actor: profile.id, payload });
    if (error) {
      console.error("rota staff save failed", { code: error.code, message: error.message });
      return { status: "error", message: "The private staff profile could not be saved." };
    }
    revalidatePath("/rotas");
    revalidatePath("/rotas/team");
    return { status: "success", message: `${values.staffName} is ready for rota suggestions.` };
  } catch {
    return { status: "error", message: "The secure payroll connection is unavailable." };
  }
}

export async function saveRotaSiteConfiguration(_previous: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const parsed = configurationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the forecast settings." };
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const dayRules = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: String(formData.get(`openTime_${weekday}`) ?? ""),
    closeTime: String(formData.get(`closeTime_${weekday}`) ?? ""),
    prepMinutes: Number(formData.get(`prepMinutes_${weekday}`)),
    closeMinutes: Number(formData.get(`closeMinutes_${weekday}`)),
    minimumStaff: Number(formData.get(`minimumStaff_${weekday}`)),
    maximumStaff: Number(formData.get(`maximumStaff_${weekday}`)),
    requiredSkills: String(formData.get(`requiredSkills_${weekday}`) ?? "").split(",").map((skill) => skill.trim().toLowerCase()).filter(Boolean),
    trading: formData.get(`trading_${weekday}`) === "true",
  }));
  const invalid = dayRules.find((rule) => !timePattern.test(rule.openTime) || !timePattern.test(rule.closeTime) || rule.closeTime <= rule.openTime || !Number.isInteger(rule.prepMinutes) || rule.prepMinutes < 0 || rule.prepMinutes > 360 || !Number.isInteger(rule.closeMinutes) || rule.closeMinutes < 0 || rule.closeMinutes > 360 || !Number.isInteger(rule.minimumStaff) || rule.minimumStaff < 1 || !Number.isInteger(rule.maximumStaff) || rule.maximumStaff < rule.minimumStaff || rule.maximumStaff > 30);
  if (invalid) return { status: "error", message: "Check opening times, preparation/close minutes and minimum/maximum cover for every day." };
  const demandSlots = [...new Set(parsed.data.demandSlots.split(",").map((slot) => slot.trim()).filter((slot) => timePattern.test(slot)))];
  if (!demandSlots.length) return { status: "error", message: "At least one valid demand time is required." };
  const rawDemand = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => demandSlots.map((slotTime) => ({
    weekday,
    slotTime,
    value: Number(formData.get(`demand_${weekday}_${slotTime.replace(":", "")}`)),
  })));
  if (rawDemand.some((point) => !Number.isFinite(point.value) || point.value < 0 || point.value > 100)) return { status: "error", message: "Demand percentages must be between 0% and 100%." };
  const demandPoints = rawDemand.map((point) => {
    const total = rawDemand.filter((candidate) => candidate.weekday === point.weekday).reduce((sum, candidate) => sum + candidate.value, 0);
    return { weekday: point.weekday, slotTime: point.slotTime, demandWeight: total ? point.value / total : 0 };
  });
  if ([0, 1, 2, 3, 4, 5, 6].some((weekday) => !demandPoints.some((point) => point.weekday === weekday && point.demandWeight > 0))) return { status: "error", message: "Every day needs at least one non-zero demand percentage." };
  if (environment.isDemo) return { status: "success", message: "Demo calibration validated. Live workspaces save an audited site configuration." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_rota_site_configuration_private", {
      target_organisation: profile.organisationId,
      target_site: parsed.data.siteId,
      target_actor: profile.id,
      payload: { ...parsed.data, dayRules, demandPoints, demandSource: parsed.data.demandMode === "manual" ? "manual" : "template" },
    });
    if (error) {
      console.error("rota configuration save failed", { code: error.code, message: error.message });
      return { status: "error", message: "The rota calibration could not be saved. No partial settings were retained." };
    }
    revalidatePath("/rotas");
    revalidatePath("/rotas/settings");
    return { status: "success", message: "Forecast calibration and all seven day rules were saved together." };
  } catch {
    return { status: "error", message: "The secure rota configuration service is unavailable." };
  }
}

export async function syncRotaCloudTeam(_previous: RotaActionState, _formData: FormData): Promise<RotaActionState> {
  void _previous;
  void _formData;
  const profile = await requireActualRole(["admin", "group_manager"]);
  if (!isRotaCloudConfigured()) return { status: "error", message: "Add ROTACLOUD_API_KEY to the server environment before syncing." };
  try {
    const admin = createAdminClient();
    const [{ locations, roles, users }, { data: sites }] = await Promise.all([
      getRotaCloudDirectory(),
      admin.from("sites").select("id, name").eq("organisation_id", profile.organisationId).eq("active", true),
    ]);
    const siteByName = new Map((sites ?? []).map((site) => [normaliseName(site.name), site]));
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const locationById = new Map(locations.map((location) => [location.id, location]));
    let saved = 0;
    let skipped = 0;
    for (const user of users) {
      const salaryType = (user.salary_type ?? "").toLowerCase();
      const hourly = salaryType.includes("hour") || salaryType === "rate";
      const defaultRoleId = user.default_role;
      const roleHourlyRate = defaultRoleId ? toPositiveNumber(user.role_rates?.[String(defaultRoleId)]?.per_hour) : null;
      const payValue = hourly ? roleHourlyRate ?? toPositiveNumber(user.salary) : toPositiveNumber(user.salary);
      const weeklyHours = toPositiveNumber(user.weekly_hours) ?? 40;
      if (!payValue) { skipped += 1; continue; }
      const matchedSites = user.locations.flatMap((locationId) => {
        const location = locationById.get(locationId);
        const site = location ? siteByName.get(normaliseName(location.name)) : undefined;
        return site ? [site] : [];
      });
      if (!matchedSites.length) { skipped += 1; continue; }
      const defaultRole = defaultRoleId ? roleById.get(defaultRoleId)?.name : undefined;
      for (const [index, site] of matchedSites.entries()) {
        const { error } = await admin.rpc("save_rota_staff_profile_private", {
          target_organisation: profile.organisationId,
          target_actor: profile.id,
          payload: {
            id: "", siteId: site.id, employeeRef: user.payroll_id?.trim() || `rotacloud:${user.id}`, rotacloudUserId: user.id,
            staffName: `${user.first_name} ${user.last_name}`.trim(), roleTitle: defaultRole ?? "Team member", skills: user.roles.map((roleId) => roleById.get(roleId)?.name.toLowerCase()).filter(Boolean),
            minimumWeeklyHours: 0, targetWeeklyHours: weeklyHours, maximumWeeklyHours: Math.max(48, weeklyHours), minimumShiftMinutes: 240, maximumShiftMinutes: 720,
            maximumConsecutiveDays: 6, preferredDays: [1, 2, 3, 4, 5], preferredStart: "", preferredEnd: "", payBasis: hourly ? "hourly" : "salaried",
            hourlyRate: hourly ? payValue : null, annualSalary: hourly ? null : payValue, contractedWeeklyHours: hourly ? null : weeklyHours,
            employerNiRate: 0, pensionRate: 0, otherOncostRate: 0, costAllocationPct: 100 / matchedSites.length, primarySite: index === 0, active: true,
            validFrom: new Date().toISOString().slice(0, 10), notes: "Synced from RotaCloud. Add working preferences and employer on-costs before first live plan.", source: "rotacloud",
          },
        });
        if (error) skipped += 1; else saved += 1;
      }
    }
    revalidatePath("/rotas");
    revalidatePath("/rotas/team");
    return { status: "success", message: `RotaCloud sync saved ${saved} site profile${saved === 1 ? "" : "s"}.${skipped ? ` ${skipped} user${skipped === 1 ? "" : "s"} need a wage or matching location.` : ""}` };
  } catch (error) {
    console.error("rotacloud team sync failed", { message: error instanceof Error ? error.message : "unknown" });
    return { status: "error", message: "RotaCloud could not be read. Check the API key and its user, wage, role and location permissions." };
  }
}

function stripPrivateShiftCosts(plan: RotaPlan) {
  return { ...plan, days: plan.days.map((day) => ({ ...day, shifts: day.shifts.map((shift) => {
    const safeShift: Partial<typeof shift> = { ...shift };
    delete safeShift.privateCost;
    return safeShift;
  }) })) };
}

const normaliseName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const toPositiveNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };

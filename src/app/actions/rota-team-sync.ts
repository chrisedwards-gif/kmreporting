"use server";

import { revalidatePath } from "next/cache";
import { requireActualRole } from "@/lib/auth/dal";
import { getRotaCloudDirectory, isRotaCloudConfigured } from "@/lib/rota/rotacloud";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaTeamSyncState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function syncRotaCloudPlanningTeam(
  _previous: RotaTeamSyncState,
  _formData: FormData,
): Promise<RotaTeamSyncState> {
  void _previous;
  void _formData;
  const profile = await requireActualRole(["admin", "group_manager"]);
  if (!isRotaCloudConfigured()) {
    return { status: "error", message: "Add ROTACLOUD_API_KEY to the server environment before syncing." };
  }

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
    let salaried = 0;

    for (const user of users) {
      const salaryType = (user.salary_type ?? "").toLowerCase();
      const hourly = salaryType.includes("hour") || salaryType === "rate";
      const defaultRoleId = user.default_role;
      const roleHourlyRate = defaultRoleId
        ? toPositiveNumber(user.role_rates?.[String(defaultRoleId)]?.per_hour)
        : null;
      const hourlyRate = hourly ? roleHourlyRate ?? toPositiveNumber(user.salary) : null;
      const weeklyHours = toPositiveNumber(user.weekly_hours) ?? 40;
      if (hourly && !hourlyRate) {
        skipped += 1;
        continue;
      }

      const matchedSites = user.locations.flatMap((locationId) => {
        const location = locationById.get(locationId);
        const site = location ? siteByName.get(normaliseName(location.name)) : undefined;
        return site ? [site] : [];
      });
      if (!matchedSites.length) {
        skipped += 1;
        continue;
      }

      const defaultRole = defaultRoleId ? roleById.get(defaultRoleId)?.name : undefined;
      for (const [index, site] of matchedSites.entries()) {
        const { error } = await admin.rpc("save_rota_staff_profile_private", {
          target_organisation: profile.organisationId,
          target_actor: profile.id,
          payload: {
            id: "",
            siteId: site.id,
            employeeRef: user.payroll_id?.trim() || `rotacloud:${user.id}`,
            rotacloudUserId: user.id,
            staffName: `${user.first_name} ${user.last_name}`.trim(),
            roleTitle: defaultRole ?? "Team member",
            skills: user.roles.map((roleId) => roleById.get(roleId)?.name.toLowerCase()).filter(Boolean),
            minimumWeeklyHours: 0,
            targetWeeklyHours: weeklyHours,
            maximumWeeklyHours: Math.max(48, weeklyHours),
            minimumShiftMinutes: 240,
            maximumShiftMinutes: 720,
            maximumConsecutiveDays: 6,
            preferredDays: [1, 2, 3, 4, 5],
            preferredStart: "",
            preferredEnd: "",
            payBasis: hourly ? "hourly" : "salaried",
            hourlyRate,
            annualSalary: null,
            contractedWeeklyHours: hourly ? null : weeklyHours,
            employerNiRate: 0,
            pensionRate: 0,
            otherOncostRate: 0,
            costAllocationPct: 100,
            primarySite: index === 0,
            active: true,
            validFrom: new Date().toISOString().slice(0, 10),
            notes: hourly
              ? "Synced from RotaCloud. Hourly pay and planning constraints may be reviewed here."
              : "Synced from RotaCloud. Salary, on-cost and site allocation remain controlled in Labour settings.",
            source: "rotacloud",
          },
        });
        if (error) skipped += 1;
        else {
          saved += 1;
          if (!hourly) salaried += 1;
        }
      }
    }

    revalidatePath("/rotas");
    revalidatePath("/rotas/team");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: `RotaCloud sync saved ${saved} site profile${saved === 1 ? "" : "s"}.${salaried ? ` ${salaried} salaried profile${salaried === 1 ? " uses" : "s use"} existing Labour allocations.` : ""}${skipped ? ` ${skipped} user${skipped === 1 ? " needs" : "s need"} an hourly rate or matching location.` : ""}`,
    };
  } catch (error) {
    console.error("rotacloud planning team sync failed", { message: error instanceof Error ? error.message : "unknown" });
    return { status: "error", message: "RotaCloud could not be read. Check its user, role, location and hourly-pay permissions." };
  }
}

const normaliseName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const toPositiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

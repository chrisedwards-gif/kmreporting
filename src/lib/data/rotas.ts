import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { environment } from "@/lib/env";
import { addDays, buildDemandCurve, type HourlySalesRow } from "@/lib/rota/forecasting";
import { getRotaCloudAvailability, isRotaCloudConfigured } from "@/lib/rota/rotacloud";
import type {
  DemandPoint,
  ExistingStaffShift,
  ForecastEvent,
  HistoricalSalesDay,
  RotaDayRule,
  RotaPlan,
  RotaStaffProfile,
} from "@/lib/rota/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type RotaSite = {
  id: string;
  code: string;
  name: string;
  labourTarget: number;
};

export type RotaStaffWorkspaceRow = {
  id: string;
  employeeRef: string;
  rotacloudUserId: number | null;
  staffName: string;
  primaryRole: string;
  skills: string[];
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  minimumShiftMinutes: number;
  maximumShiftMinutes: number;
  maximumConsecutiveDays: number;
  preferredDays: number[];
  preferredStart: string | null;
  preferredEnd: string | null;
  notes: string;
  active: boolean;
  siteId: string;
  roleTitle: string;
  payBasis: "hourly" | "salaried";
  hourlyRate: number | null;
  annualSalary: number | null;
  contractedWeeklyHours: number | null;
  employerNiRate: number;
  pensionRate: number;
  otherOncostRate: number;
  costAllocationPct: number;
  primarySite: boolean;
  validFrom: string;
  validTo: string | null;
};

export type StoredRotaPlan = RotaPlan & { id: string; version: number; status: string };

export type RotaPlanningWorkspace = {
  sites: RotaSite[];
  selectedSite: RotaSite | null;
  weekStart: string;
  history: HistoricalSalesDay[];
  events: ForecastEvent[];
  dayRules: RotaDayRule[];
  demand: DemandPoint[];
  staff: RotaStaffProfile[];
  existingShifts: ExistingStaffShift[];
  latestPlan: StoredRotaPlan | null;
  forecastWeeks: number;
  minimumHistoryWeeks: number;
  minimumRestHours: number;
  intervalMinutes: number;
  salesPerLabourHourTarget: number;
  rotacloudConfigured: boolean;
  error: string | null;
};

const toNumber = (value: unknown) => Number(value ?? 0);
const toTime = (value: unknown) => value == null ? null : String(value).slice(0, 5);

export function nextMonday(date = new Date()) {
  const atNoon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const days = (8 - atNoon.getUTCDay()) % 7 || 7;
  atNoon.setUTCDate(atNoon.getUTCDate() + days);
  return atNoon.toISOString().slice(0, 10);
}

export function normaliseWeekStart(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return nextMonday();
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return nextMonday();
  const day = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() - (day === 0 ? 6 : day - 1));
  return parsed.toISOString().slice(0, 10);
}

export async function getRotaPlanningWorkspace(input: {
  profile: SessionProfile;
  requestedSiteId?: string;
  requestedWeekStart?: string;
}): Promise<RotaPlanningWorkspace> {
  const weekStart = normaliseWeekStart(input.requestedWeekStart);
  if (environment.isDemo) return demoWorkspace(input.profile, input.requestedSiteId, weekStart);

  const empty: RotaPlanningWorkspace = {
    sites: [], selectedSite: null, weekStart, history: [], events: [], dayRules: [], demand: [], staff: [],
    existingShifts: [], latestPlan: null, forecastWeeks: 8, minimumHistoryWeeks: 4, minimumRestHours: 11,
    intervalMinutes: 60, salesPerLabourHourTarget: 95, rotacloudConfigured: isRotaCloudConfigured(), error: null,
  };

  try {
    const admin = createAdminClient();
    const { data: rawSites, error: siteError } = await admin
      .from("sites")
      .select("id, code, name, labour_target")
      .eq("organisation_id", input.profile.organisationId)
      .eq("active", true)
      .order("name");
    if (siteError) return { ...empty, error: "Kitchen data could not be loaded." };
    const sites = (rawSites ?? [])
      .filter((site) => scopeContainsSite(input.profile.siteScopeIds, site.id))
      .map((site) => ({ id: site.id, code: site.code, name: site.name, labourTarget: toNumber(site.labour_target) }));
    const selectedSite = sites.find((site) => site.id === input.requestedSiteId) ?? sites[0] ?? null;
    if (!selectedSite) return { ...empty, sites, error: "No active kitchen is available in this workspace." };

    const historyStart = addDays(weekStart, -26 * 7);
    const weekEnd = addDays(weekStart, 6);
    const [settingsResult, rulesResult, demandResult, hourlyResult, eventsResult, reportsResult, privateResult, planResult] = await Promise.all([
      admin.from("rota_site_settings").select("forecast_weeks, minimum_history_weeks, interval_minutes, minimum_rest_hours, sales_per_labour_hour_target").eq("site_id", selectedSite.id).maybeSingle(),
      admin.from("rota_day_rules").select("weekday, open_time, close_time, prep_minutes, close_minutes, minimum_staff, maximum_staff, required_skills, trading").eq("site_id", selectedSite.id).order("weekday"),
      admin.from("rota_demand_templates").select("weekday, slot_time, demand_weight, source").eq("site_id", selectedSite.id).order("weekday").order("slot_time"),
      admin.from("hourly_sales_metrics").select("business_date, slot_time, net_sales").eq("site_id", selectedSite.id).gte("business_date", historyStart).lt("business_date", weekStart).order("business_date").order("slot_time"),
      admin.from("rota_forecast_events").select("event_date, title, sales_uplift_pct, source").eq("site_id", selectedSite.id).gte("event_date", weekStart).lte("event_date", weekEnd).order("event_date"),
      admin.from("weekly_reports").select("id").eq("organisation_id", input.profile.organisationId).eq("site_id", selectedSite.id),
      admin.rpc("get_rota_private_staff", { target_organisation: input.profile.organisationId, target_site: selectedSite.id, target_week_start: weekStart }),
      admin.from("rota_plans").select("*").eq("site_id", selectedSite.id).eq("week_start", weekStart).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const unavailable = [settingsResult.error, rulesResult.error, demandResult.error, hourlyResult.error, eventsResult.error, privateResult.error, planResult.error].find(Boolean);
    if (unavailable) {
      return { ...empty, sites, selectedSite, error: "Rota intelligence is waiting for its staging database migration." };
    }

    const reportIds = (reportsResult.data ?? []).map((report) => report.id);
    const salesResult = reportIds.length
      ? await admin.from("report_sales_days").select("business_date, net_sales").in("report_id", reportIds).gte("business_date", historyStart).lt("business_date", weekStart).order("business_date")
      : { data: [], error: null };
    const settings = settingsResult.data;
    const hourlyRows: HourlySalesRow[] = (hourlyResult.data ?? []).map((row) => ({
      businessDate: row.business_date,
      slotTime: String(row.slot_time).slice(0, 5),
      netSales: toNumber(row.net_sales),
    }));
    const dailySales = new Map<string, number>();
    for (const row of hourlyRows) dailySales.set(row.businessDate, (dailySales.get(row.businessDate) ?? 0) + row.netSales);
    // A weekly report's reconciled daily total is authoritative. Hourly EPOS
    // data fills gaps where that report has not yet been created.
    for (const row of salesResult.data ?? []) dailySales.set(row.business_date, toNumber(row.net_sales));
    const history = [...dailySales].map(([businessDate, netSales]) => ({ businessDate, netSales })).sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    const fallbackDemand = (demandResult.data ?? []).map((row) => ({
      weekday: row.weekday,
      slotTime: String(row.slot_time).slice(0, 5),
      demandWeight: toNumber(row.demand_weight),
      source: row.source as DemandPoint["source"],
    }));
    const demand = buildDemandCurve({
      rows: hourlyRows,
      fallback: fallbackDemand,
      intervalMinutes: settings?.interval_minutes ?? 60,
      minimumHistoryWeeks: settings?.minimum_history_weeks ?? 4,
    });
    const staff = ((privateResult.data ?? []) as unknown as Array<Record<string, unknown>>).map(mapPrivateStaff);

    if (isRotaCloudConfigured()) {
      try {
        const availability = await getRotaCloudAvailability(weekStart, weekEnd);
        staff.forEach((item) => { if (item.rotacloudUserId) item.availability = availability.get(item.rotacloudUserId); });
      } catch (error) {
        console.error("rotacloud availability fetch failed", { message: error instanceof Error ? error.message : "unknown" });
      }
    }

    const stored = planResult.data ? await hydrateStoredPlan(admin, planResult.data) : null;
    const otherPlans = staff.length
      ? await admin.from("rota_plan_shifts").select("staff_profile_id, shift_start, shift_end, rota_plans!inner(status)").eq("organisation_id", input.profile.organisationId).gte("shift_start", `${weekStart}T00:00:00Z`).lte("shift_start", `${weekEnd}T23:59:59Z`).neq("site_id", selectedSite.id).neq("rota_plans.status", "superseded")
      : { data: [], error: null };

    return {
      sites,
      selectedSite,
      weekStart,
      history,
      events: (eventsResult.data ?? []).map((row) => ({ eventDate: row.event_date, title: row.title, salesUpliftPct: toNumber(row.sales_uplift_pct), source: row.source as ForecastEvent["source"] })),
      dayRules: (rulesResult.data ?? []).map((row) => ({
        weekday: row.weekday,
        openTime: String(row.open_time).slice(0, 5),
        closeTime: String(row.close_time).slice(0, 5),
        prepMinutes: row.prep_minutes,
        closeMinutes: row.close_minutes,
        minimumStaff: row.minimum_staff,
        maximumStaff: row.maximum_staff,
        requiredSkills: row.required_skills ?? [],
        trading: row.trading,
      })),
      demand,
      staff,
      existingShifts: (otherPlans.data ?? []).flatMap((row) => row.staff_profile_id ? [{ staffProfileId: row.staff_profile_id, shiftStart: row.shift_start, shiftEnd: row.shift_end }] : []),
      latestPlan: stored,
      forecastWeeks: settings?.forecast_weeks ?? 8,
      minimumHistoryWeeks: settings?.minimum_history_weeks ?? 4,
      minimumRestHours: toNumber(settings?.minimum_rest_hours) || 11,
      intervalMinutes: settings?.interval_minutes ?? 60,
      salesPerLabourHourTarget: toNumber(settings?.sales_per_labour_hour_target) || 95,
      rotacloudConfigured: isRotaCloudConfigured(),
      error: salesResult.error ? "Historical sales could not be loaded; the planner will show a low-confidence result." : null,
    };
  } catch (error) {
    console.error("rota workspace load failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ...empty, error: "Rota intelligence could not be loaded." };
  }
}

export async function getRotaStaffWorkspace(profile: SessionProfile): Promise<{ sites: RotaSite[]; staff: RotaStaffWorkspaceRow[]; rotacloudConfigured: boolean; error: string | null }> {
  if (environment.isDemo) {
    const workspace = demoWorkspace(profile, undefined, nextMonday());
    return { sites: workspace.sites, staff: demoStaffWorkspace(workspace.sites[0]?.id ?? "kardia"), rotacloudConfigured: false, error: null };
  }
  try {
    const admin = createAdminClient();
    const [{ data: siteRows, error: siteError }, { data, error }] = await Promise.all([
      admin.from("sites").select("id, code, name, labour_target").eq("organisation_id", profile.organisationId).eq("active", true).order("name"),
      admin.rpc("get_rota_private_workspace", { target_organisation: profile.organisationId }),
    ]);
    if (siteError || error) return { sites: [], staff: [], rotacloudConfigured: isRotaCloudConfigured(), error: "The private rota team workspace is waiting for its database migration." };
    const sites = (siteRows ?? []).map((site) => ({ id: site.id, code: site.code, name: site.name, labourTarget: toNumber(site.labour_target) }));
    return { sites, staff: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(mapStaffWorkspace), rotacloudConfigured: isRotaCloudConfigured(), error: null };
  } catch {
    return { sites: [], staff: [], rotacloudConfigured: isRotaCloudConfigured(), error: "The private rota team workspace could not be loaded." };
  }
}

function mapPrivateStaff(row: Record<string, unknown>): RotaStaffProfile {
  return {
    id: String(row.id), employeeRef: String(row.employeeRef ?? ""), rotacloudUserId: row.rotacloudUserId == null ? null : Number(row.rotacloudUserId),
    staffName: String(row.staffName ?? ""), primaryRole: String(row.primaryRole ?? ""), roleTitle: String(row.roleTitle ?? ""), skills: (row.skills ?? []) as string[],
    minimumWeeklyHours: toNumber(row.minimumWeeklyHours), targetWeeklyHours: toNumber(row.targetWeeklyHours), maximumWeeklyHours: toNumber(row.maximumWeeklyHours),
    minimumShiftMinutes: toNumber(row.minimumShiftMinutes), maximumShiftMinutes: toNumber(row.maximumShiftMinutes), maximumConsecutiveDays: toNumber(row.maximumConsecutiveDays),
    preferredDays: (row.preferredDays ?? []) as number[], preferredStart: toTime(row.preferredStart), preferredEnd: toTime(row.preferredEnd),
    payBasis: row.payBasis as "hourly" | "salaried", loadedHourlyRate: toNumber(row.loadedHourlyRate), fixedWeeklyCost: toNumber(row.fixedWeeklyCost), costAllocationPct: toNumber(row.costAllocationPct),
  };
}

function mapStaffWorkspace(row: Record<string, unknown>): RotaStaffWorkspaceRow {
  return {
    id: String(row.id), employeeRef: String(row.employeeRef ?? ""), rotacloudUserId: row.rotacloudUserId == null ? null : Number(row.rotacloudUserId), staffName: String(row.staffName ?? ""),
    primaryRole: String(row.primaryRole ?? ""), skills: (row.skills ?? []) as string[], minimumWeeklyHours: toNumber(row.minimumWeeklyHours), targetWeeklyHours: toNumber(row.targetWeeklyHours),
    maximumWeeklyHours: toNumber(row.maximumWeeklyHours), minimumShiftMinutes: toNumber(row.minimumShiftMinutes), maximumShiftMinutes: toNumber(row.maximumShiftMinutes), maximumConsecutiveDays: toNumber(row.maximumConsecutiveDays),
    preferredDays: (row.preferredDays ?? []) as number[], preferredStart: toTime(row.preferredStart), preferredEnd: toTime(row.preferredEnd), notes: String(row.notes ?? ""), active: Boolean(row.active),
    siteId: String(row.siteId), roleTitle: String(row.roleTitle ?? ""), payBasis: row.payBasis as "hourly" | "salaried", hourlyRate: row.hourlyRate == null ? null : toNumber(row.hourlyRate),
    annualSalary: row.annualSalary == null ? null : toNumber(row.annualSalary), contractedWeeklyHours: row.contractedWeeklyHours == null ? null : toNumber(row.contractedWeeklyHours), employerNiRate: toNumber(row.employerNiRate),
    pensionRate: toNumber(row.pensionRate), otherOncostRate: toNumber(row.otherOncostRate), costAllocationPct: toNumber(row.costAllocationPct), primarySite: Boolean(row.primarySite), validFrom: String(row.validFrom), validTo: row.validTo == null ? null : String(row.validTo),
  };
}

async function hydrateStoredPlan(admin: ReturnType<typeof createAdminClient>, row: Record<string, unknown>): Promise<StoredRotaPlan> {
  const [{ data: days }, { data: shifts }] = await Promise.all([
    admin.from("rota_plan_days").select("*").eq("plan_id", String(row.id)).order("business_date"),
    admin.from("rota_plan_shifts").select("*").eq("plan_id", String(row.id)).order("shift_start"),
  ]);
  const mappedDays = (days ?? []).map((day) => {
    const dayShifts = (shifts ?? []).filter((shift) => shift.plan_day_id === day.id).map((shift) => ({
      staffProfileId: shift.staff_profile_id, staffName: shift.staff_name, roleTitle: shift.role_title, shiftStart: shift.shift_start, shiftEnd: shift.shift_end,
      breakMinutes: shift.break_minutes, paidMinutes: shift.paid_minutes, requiredSkill: shift.required_skill, assignmentReason: shift.assignment_reason,
      payBasis: shift.staff_profile_id ? "hourly" as const : "unfilled" as const, privateCost: 0,
    }));
    return {
      businessDate: day.business_date, forecastSales: toNumber(day.forecast_sales), forecastLow: toNumber(day.forecast_low), forecastHigh: toNumber(day.forecast_high),
      labourBudget: toNumber(day.labour_budget), fixedLabourCost: toNumber(day.fixed_labour_cost), controllableBudget: toNumber(day.controllable_budget), plannedCost: toNumber(day.planned_cost), plannedHours: toNumber(day.planned_hours),
      peakTime: toTime(day.peak_time), coverage: (day.evidence?.coverage ?? []) as RotaPlan["days"][number]["coverage"], evidence: day.evidence ?? {}, warnings: day.warnings ?? [], shifts: dayShifts,
    };
  });
  return {
    id: String(row.id), version: toNumber(row.version), status: String(row.status), weekStart: String(row.week_start), weekEnd: String(row.week_end),
    forecastSales: toNumber(row.forecast_sales), forecastLow: toNumber(row.forecast_low), forecastHigh: toNumber(row.forecast_high), labourTargetPct: toNumber(row.labour_target_pct), labourBudget: toNumber(row.labour_budget),
    plannedCost: toNumber(row.planned_cost), plannedHours: toNumber(row.planned_hours), accuracyMape: row.accuracy_mape == null ? null : toNumber(row.accuracy_mape), confidence: row.confidence as RotaPlan["confidence"],
    explanation: String(row.explanation ?? ""), warnings: (row.warnings ?? []) as string[], days: mappedDays,
  };
}

function demoWorkspace(profile: SessionProfile, requestedSiteId: string | undefined, weekStart: string): RotaPlanningWorkspace {
  const allSites: RotaSite[] = [
    { id: "00000000-0000-4000-8000-000000000001", code: "DR-MCR", name: "Dough Religion", labourTarget: 28 },
    { id: "kardia", code: "KAR-MCR", name: "Kardia", labourTarget: 30 },
  ];
  const sites = allSites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
  const selectedSite = sites.find((site) => site.id === requestedSiteId) ?? sites[0] ?? null;
  const history: HistoricalSalesDay[] = [];
  for (let weeksAgo = 12; weeksAgo >= 1; weeksAgo -= 1) {
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(weekStart, -weeksAgo * 7 + day);
      const base = [1150, 1300, 1450, 1600, 2200, 3000, 2450][day];
      const variance = 1 + (((weeksAgo * 17 + day * 11) % 13) - 6) / 100;
      history.push({ businessDate: date, netSales: Math.round(base * variance) });
    }
  }
  const dayRules = Array.from({ length: 7 }, (_, day) => ({ weekday: (day + 1) % 7, openTime: "10:00", closeTime: day >= 4 ? "22:00" : "21:00", prepMinutes: 0, closeMinutes: 0, minimumStaff: 2, maximumStaff: day >= 4 ? 4 : 3, requiredSkills: ["kitchen manager"], trading: true }));
  const weights = [[10, .04], [11, .05], [12, .08], [13, .1], [14, .07], [15, .06], [16, .08], [17, .14], [18, .15], [19, .11], [20, .07], [21, .05]];
  const demand = Array.from({ length: 7 }, (_, day) => weights.map(([hour, weight]) => ({ weekday: (day + 1) % 7, slotTime: `${hour}:00`, demandWeight: weight, source: "template" as const }))).flat();
  return {
    sites, selectedSite, weekStart, history, events: [{ eventDate: addDays(weekStart, 5), title: "Saturday city-centre trade", salesUpliftPct: 0, source: "manual" }], dayRules, demand,
    staff: demoStaff(), existingShifts: [], latestPlan: null, forecastWeeks: 8, minimumHistoryWeeks: 4, minimumRestHours: 11, intervalMinutes: 60, salesPerLabourHourTarget: 100, rotacloudConfigured: false, error: null,
  };
}

function demoStaff(): RotaStaffProfile[] {
  const rows = [
    ["Scott Hutton", "Kitchen Manager", "salaried", 17.8, 673, 40, 48, [1, 2, 3, 4, 5]],
    ["Warren Raisbeck", "Kitchen Manager", "hourly", 16.4, 0, 32, 45, [2, 3, 4, 5, 6]],
    ["Bhavya Pawar", "Pizzaiolo", "hourly", 14.2, 0, 32, 44, [1, 2, 4, 5, 6]],
    ["Finlay James", "Pizzaiolo", "hourly", 13.5, 0, 24, 40, [2, 3, 4, 5, 6]],
    ["Logan Butler", "Pizzaiolo", "hourly", 13.2, 0, 28, 42, [1, 3, 4, 5, 6]],
    ["Owen Birrell", "Pizzaiolo", "hourly", 14, 0, 32, 44, [1, 2, 3, 5, 0]],
    ["Beth Redruth", "Pizzaiolo", "hourly", 12.9, 0, 20, 36, [1, 2, 3, 0]],
  ] as const;
  return rows.map((row, index) => ({ id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`, employeeRef: `DEMO-${index + 1}`, rotacloudUserId: null, staffName: row[0], primaryRole: row[1], roleTitle: row[1], skills: [row[1].toLowerCase()], minimumWeeklyHours: Math.max(0, row[5] - 8), targetWeeklyHours: row[5], maximumWeeklyHours: row[6], minimumShiftMinutes: 240, maximumShiftMinutes: 720, maximumConsecutiveDays: 5, preferredDays: [...row[7]], preferredStart: "10:00", preferredEnd: "22:00", payBasis: row[2], loadedHourlyRate: row[3], fixedWeeklyCost: row[4], costAllocationPct: 100 }));
}

function demoStaffWorkspace(siteId: string): RotaStaffWorkspaceRow[] {
  return demoStaff().map((staff) => ({ ...staff, notes: "Demo profile", siteId, hourlyRate: staff.payBasis === "hourly" ? staff.loadedHourlyRate : null, annualSalary: staff.payBasis === "salaried" ? staff.fixedWeeklyCost * 52 : null, contractedWeeklyHours: staff.targetWeeklyHours, employerNiRate: 0, pensionRate: 0, otherOncostRate: 0, primarySite: true, validFrom: "2026-01-01", validTo: null, active: true }));
}

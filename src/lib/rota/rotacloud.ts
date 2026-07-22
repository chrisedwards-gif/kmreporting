import "server-only";

import { environment } from "@/lib/env";
import {
  mergeRotaCloudAvailability,
  type RotaCloudAvailabilityRow,
  type RotaCloudLeaveRow,
} from "@/lib/rota/rotacloud-mapping";

const API_ROOT = "https://api.rotacloud.com/v1";

export type RotaCloudLocation = {
  id: number;
  deleted: boolean;
  name: string;
  users: number[];
};

export type RotaCloudRole = {
  id: number;
  deleted: boolean;
  name: string;
  default_break: number;
  users: number[];
};

export type RotaCloudUser = {
  id: number;
  deleted: boolean;
  first_name: string;
  last_name: string;
  locations: number[];
  roles: number[];
  default_role: number | null;
  weekly_hours: number | null;
  payroll_id: string | null;
  salary: number | null;
  salary_type: "hourly" | "annual" | "salary" | string | null;
  overtime_rate: number | null;
  role_rates: Record<string, { per_hour?: number; per_shift?: number }> | null;
  notes: string | null;
};

export const isRotaCloudConfigured = () => Boolean(environment.rotacloudApiKey);

async function getAll<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T[]> {
  if (!environment.rotacloudApiKey) throw new Error("RotaCloud is not configured.");
  const pageSize = 200;
  const rows: T[] = [];
  let offset = 0;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL(`${API_ROOT}/${path.replace(/^\//, "")}`);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${environment.rotacloudApiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`RotaCloud returned ${response.status}.`);
    const pageRows = await response.json() as T[];
    if (!Array.isArray(pageRows)) throw new Error("RotaCloud returned an unexpected response.");
    rows.push(...pageRows);
    const totalHeader = response.headers.get("X-Total-Count");
    const total = totalHeader === null ? null : Number(totalHeader);
    if (!pageRows.length || (total !== null && Number.isFinite(total) && rows.length >= total) || (total === null && pageRows.length < pageSize)) return rows;
    offset += pageRows.length;
  }
  throw new Error("RotaCloud pagination exceeded the safety limit.");
}

export async function getRotaCloudDirectory() {
  const [locations, roles, users] = await Promise.all([
    getAll<RotaCloudLocation>("locations"),
    getAll<RotaCloudRole>("roles"),
    getAll<RotaCloudUser>("users"),
  ]);
  return {
    locations: locations.filter((location) => !location.deleted),
    roles: roles.filter((role) => !role.deleted),
    users: users.filter((user) => !user.deleted),
  };
}

export async function getRotaCloudAvailability(weekStart: string, weekEnd: string) {
  const [availability, leave] = await Promise.all([
    getAll<RotaCloudAvailabilityRow>("availability", { start: weekStart, end: weekEnd }),
    getAll<RotaCloudLeaveRow>("leave", { start: weekStart, end: weekEnd, include_deleted: false, include_denied: false }),
  ]);
  return mergeRotaCloudAvailability(availability, leave);
}

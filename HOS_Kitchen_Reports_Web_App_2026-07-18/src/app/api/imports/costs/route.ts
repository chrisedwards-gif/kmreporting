import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { environment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const payRate = z.object({
  employeeRef: z.string().min(1).max(120),
  hourlyRate: z.number().positive().optional(),
  annualSalary: z.number().positive().optional(),
  contractedWeeklyHours: z.number().positive().optional(),
  employerNiRate: z.number().min(0).max(1).default(0),
  pensionRate: z.number().min(0).max(1).default(0),
  otherOncostRate: z.number().min(0).max(1).default(0),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable().optional(),
}).refine(
  (rate) => Boolean(rate.hourlyRate) !== Boolean(rate.annualSalary),
  "Provide either an hourly rate or annual salary.",
).refine(
  (rate) => !rate.annualSalary || Boolean(rate.contractedWeeklyHours),
  "Salaried rates require contracted weekly hours.",
);

const timeEntry = z.object({
  employeeRef: z.string().min(1).max(120),
  paidHours: z.number().min(0),
  agencyCost: z.number().min(0).default(0),
  overtimePremium: z.number().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const importSchema = z.object({
  organisationId: z.uuid(),
  siteId: z.uuid(),
  periodId: z.uuid(),
  payRates: z.array(payRate).max(1_000).default([]),
  timeEntries: z.array(timeEntry).max(5_000).default([]),
});

export async function POST(request: NextRequest) {
  if (!environment.importSecret || request.headers.get("authorization") !== `Bearer ${environment.importSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = importSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid cost import", issues: payload.error.issues }, { status: 400 });
  }

  // The request body is intentionally never logged: it may contain salary and rate data.
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("import_private_cost_data", { payload: payload.data });
  if (error) return NextResponse.json({ error: "The private cost import failed." }, { status: 500 });
  return NextResponse.json({ ok: true, siteId: payload.data.siteId, periodId: payload.data.periodId });
}

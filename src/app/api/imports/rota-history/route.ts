import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { environment } from "@/lib/env";
import { hasValidBearerSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

const labourDaySchema = z.object({
  businessDate: z.iso.date(),
  scheduledHours: z.number().min(0).default(0),
  scheduledHourlyCost: z.number().min(0).default(0),
  actualHours: z.number().min(0).default(0),
  actualHourlyCost: z.number().min(0).default(0),
  salaryCostAllocated: z.number().min(0).default(0),
  scheduledShiftCount: z.number().int().min(0).default(0),
  actualShiftCount: z.number().int().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const importSchema = z.object({
  organisationId: z.uuid(),
  siteId: z.uuid(),
  sourceSystem: z.string().trim().min(2).max(80),
  days: z.array(labourDaySchema).min(1).max(740),
});

export async function POST(request: NextRequest) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), environment.importSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rota history import", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("import_rota_labour_metrics", { payload: parsed.data });
  if (error) {
    console.error("rota history import failed", {
      code: error.code,
      message: error.message,
      siteId: parsed.data.siteId,
      sourceSystem: parsed.data.sourceSystem,
    });
    return NextResponse.json({ error: "The rota history import failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: parsed.data.days.length,
    siteId: parsed.data.siteId,
    sourceSystem: parsed.data.sourceSystem,
  });
}

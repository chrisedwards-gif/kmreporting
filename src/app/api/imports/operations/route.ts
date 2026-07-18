import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { environment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const metric = z.object({
  businessDate: z.iso.date(),
  grossSales: z.number().min(0).default(0),
  netSales: z.number().min(0).default(0),
  covers: z.number().int().min(0).default(0),
  foodPurchases: z.number().min(0).default(0),
  credits: z.number().min(0).default(0),
  wasteCost: z.number().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const importSchema = z.object({
  organisationId: z.uuid(),
  siteId: z.uuid(),
  sourceSystem: z.string().min(2).max(80),
  domains: z.array(z.enum(["sales", "purchasing", "waste"])).min(1),
  metrics: z.array(metric).min(1).max(370),
});

export async function POST(request: NextRequest) {
  if (!environment.importSecret || request.headers.get("authorization") !== `Bearer ${environment.importSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid operations import", issues: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("import_operating_metrics", { payload: parsed.data });
  if (error) return NextResponse.json({ error: "The operations import failed." }, { status: 500 });
  return NextResponse.json({
    ok: true,
    imported: parsed.data.metrics.length,
    domains: parsed.data.domains,
    siteId: parsed.data.siteId,
  });
}

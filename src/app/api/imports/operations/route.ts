import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { environment } from "@/lib/env";
import { hasValidBearerSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

const metric = z.object({
  businessDate: z.iso.date(),
  grossSales: z.number().min(0).default(0),
  netSales: z.number().min(0).default(0),
  transactions: z.number().int().min(0).default(0),
  covers: z.number().int().min(0).default(0),
  foodPurchases: z.number().min(0).default(0),
  credits: z.number().min(0).default(0),
  wasteCost: z.number().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const itemMetric = z.object({
  businessDate: z.iso.date(),
  itemName: z.string().trim().min(1).max(180),
  category: z.string().trim().min(1).max(120).default("Uncategorised"),
  quantity: z.number().min(0).default(0),
  netSales: z.number().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const categoryMetric = z.object({
  businessDate: z.iso.date(),
  category: z.string().trim().min(1).max(120),
  quantity: z.number().min(0).default(0),
  netSales: z.number().min(0).default(0),
  sourceReference: z.string().max(250).optional(),
});

const importSchema = z.object({
  organisationId: z.uuid(),
  siteId: z.uuid(),
  sourceSystem: z.string().min(2).max(80),
  domains: z.array(z.enum(["sales", "purchasing", "waste"])).min(1),
  metrics: z.array(metric).min(1).max(370),
  items: z.array(itemMetric).max(10_000).optional(),
  categories: z.array(categoryMetric).max(2_000).optional(),
});

export async function POST(request: NextRequest) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), environment.importSecret)) {
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
    itemRows: parsed.data.items?.length ?? 0,
    categoryRows: parsed.data.categories?.length ?? 0,
    domains: parsed.data.domains,
    siteId: parsed.data.siteId,
  });
}

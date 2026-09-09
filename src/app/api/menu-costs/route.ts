import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionProfile } from "@/lib/auth/dal";
import { parseCsv } from "@/lib/reporting/imports";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normaliseHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const itemKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const parseMoney = (value: string) => {
  const parsed = Number(value.replace(/[£,$\s()]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const findHeader = (headers: string[], candidates: string[]) => {
  const keys = candidates.map(normaliseHeader);
  return headers.find((header) => keys.includes(normaliseHeader(header)))
    ?? headers.find((header) => keys.some((key) => normaliseHeader(header).includes(key)));
};

export async function POST(request: NextRequest) {
  const profile = await requireSessionProfile();
  if (!(["admin", "group_manager"] as string[]).includes(profile.actualRole) || profile.isAccessPreview) {
    return NextResponse.json({ error: "Menu cost imports are restricted to group management." }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  const siteId = String(form.get("siteId") ?? "");
  const validFrom = String(form.get("validFrom") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a CSV item-cost file." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return NextResponse.json({ error: "Choose the date these costs become effective." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "The item-cost file is larger than 10 MB." }, { status: 413 });

  const admin = createAdminClient();
  const { data: site } = await admin.from("sites").select("id, name").eq("id", siteId).eq("organisation_id", profile.organisationId).eq("active", true).maybeSingle();
  if (!site) return NextResponse.json({ error: "That kitchen is unavailable." }, { status: 404 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("windows-1252").decode(bytes);
  const [rawHeaders = [], ...rows] = parseCsv(text);
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  const itemHeader = findHeader(headers, ["item name", "item", "product name", "product", "dish", "recipe name", "plu description"]);
  const costHeader = findHeader(headers, ["unit food cost", "food cost", "unit cost", "recipe cost", "cost per portion", "portion cost", "cost"]);
  if (!itemHeader || !costHeader) {
    return NextResponse.json({ error: "The CSV needs an item/product column and a unit/recipe food-cost column." }, { status: 400 });
  }
  const itemIndex = headers.indexOf(itemHeader);
  const costIndex = headers.indexOf(costHeader);
  const parsed = new Map<string, { itemName: string; unitFoodCost: number }>();
  for (const row of rows) {
    const itemName = (row[itemIndex] ?? "").trim();
    const unitFoodCost = parseMoney(row[costIndex] ?? "");
    const key = itemKey(itemName);
    if (!key || !Number.isFinite(unitFoodCost) || unitFoodCost <= 0) continue;
    parsed.set(key, { itemName: itemName.slice(0, 180), unitFoodCost: Math.round(unitFoodCost * 10000) / 10000 });
  }
  if (!parsed.size) return NextResponse.json({ error: "No positive item costs could be read from the CSV." }, { status: 400 });

  const hash = createHash("sha256").update(bytes).digest("hex");
  const fileId = randomUUID();
  const storagePath = `${profile.organisationId}/menu-costs/${siteId}/${validFrom}/${fileId}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120)}`;
  const { error: storageError } = await admin.storage.from("weekly-report-packs").upload(storagePath, bytes, { contentType: file.type || "text/csv", upsert: false });
  if (storageError) return NextResponse.json({ error: "The source cost file could not be retained privately." }, { status: 500 });

  const previousDay = new Date(`${validFrom}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const priorEnd = previousDay.toISOString().slice(0, 10);
  for (const [key] of parsed) {
    await admin.from("menu_item_costs").update({ valid_to: priorEnd, updated_at: new Date().toISOString() })
      .eq("site_id", siteId).eq("item_key", key).is("valid_to", null).lt("valid_from", validFrom);
  }
  const sourceReference = `${file.name}:${hash.slice(0, 16)}`;
  const costRows = [...parsed.entries()].map(([key, value]) => ({
    organisation_id: profile.organisationId,
    site_id: siteId,
    item_name: value.itemName,
    item_key: key,
    unit_food_cost: value.unitFoodCost,
    source_system: "menu_cost_csv",
    source_reference: sourceReference,
    valid_from: validFrom,
    valid_to: null,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await admin.from("menu_item_costs").upsert(costRows, { onConflict: "site_id,item_key,valid_from" });
  if (upsertError) return NextResponse.json({ error: "The item costs could not be saved." }, { status: 500 });
  await admin.from("audit_log").insert({ organisation_id: profile.organisationId, actor_id: profile.id, action: "menu_costs.imported", entity_type: "site", entity_id: siteId, detail: { site_name: site.name, rows: costRows.length, valid_from: validFrom, source_reference: sourceReference } });
  return NextResponse.json({ ok: true, siteName: site.name, imported: costRows.length, validFrom, sourceReference });
}

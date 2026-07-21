import { NextRequest, NextResponse } from "next/server";
import { requireSessionProfile } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  await requireSessionProfile();
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("site") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const reportId = searchParams.get("report") || null;

  if (!uuid.test(siteId) || !isoDate.test(start) || !isoDate.test(end) || (reportId && !uuid.test(reportId))) {
    return NextResponse.json({ error: "Invalid report support request." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  const { data, error } = await supabase.rpc("get_report_support_summary", {
    target_site: siteId,
    range_start: start,
    range_end: end,
    target_report: reportId,
  });
  if (error) {
    console.error("report support summary failed", { code: error.code, message: error.message, siteId, start, end });
    return NextResponse.json({ error: "Report support totals could not be loaded." }, { status: 500 });
  }
  return NextResponse.json(data ?? {
    wasteTotal: 0,
    wasteEntryCount: 0,
    salariesIncluded: false,
    salaryBaseCost: 0,
    salaryOncostCost: 0,
    salaryTotalCost: 0,
  });
}

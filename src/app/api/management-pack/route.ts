import type { NextRequest } from "next/server";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getReportSalesInsights } from "@/lib/data/sales-insights";
import { getScopedReportingBundle } from "@/lib/data/scoped-reporting";
import { buildManagementPackPdf } from "@/lib/pdf/management-pack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager", "finance", "viewer"]);
  const periodId = request.nextUrl.searchParams.get("period") || undefined;
  const { week, reports, expectedSites } = await getScopedReportingBundle(profile, periodId);

  try {
    const insightEntries = await Promise.all(reports.map(async (report) => [
      report.id,
      await getReportSalesInsights({ reportId: report.id, siteId: report.siteId, weekStart: report.weekStart }),
    ] as const));
    const pdf = buildManagementPackPdf({
      week,
      reports,
      expectedSites,
      preparedFor: "Jake Atkinson",
      salesInsightsByReport: Object.fromEntries(insightEntries),
    });
    return new Response(pdf, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="HOS-Weekly-Management-Pack-${week.end}.pdf"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the management pack.";
    return Response.json({ error: message }, { status: 409 });
  }
}

import { z } from "zod";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { buildProbationReviewPdf, type ProbationFinalSnapshot } from "@/lib/pdf/probation-review";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const reviewIdSchema = z.string().uuid();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "Manager";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const parsed = reviewIdSchema.safeParse((await params).reviewId);
  if (!parsed.success) return Response.json({ error: "Probation record not found." }, { status: 404 });
  const supabase = await createServerSupabaseClient();
  if (!supabase) return Response.json({ error: "The database connection is unavailable." }, { status: 503 });
  const { data, error } = await supabase
    .from("probation_reviews")
    .select("id, status, final_snapshot")
    .eq("id", parsed.data)
    .eq("status", "finalised")
    .maybeSingle();
  if (error || !data || !data.final_snapshot || Object.keys(data.final_snapshot).length === 0) {
    return Response.json({ error: "Only a finalised probation record can be downloaded." }, { status: 404 });
  }

  const snapshot = data.final_snapshot as ProbationFinalSnapshot;
  try {
    const pdf = buildProbationReviewPdf(snapshot);
    return new Response(pdf, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="HOS-Probation-${safeName(snapshot.manager.fullName)}-${snapshot.review.reviewDate}.pdf"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (pdfError) {
    return Response.json({ error: pdfError instanceof Error ? pdfError.message : "The probation PDF could not be generated." }, { status: 409 });
  }
}

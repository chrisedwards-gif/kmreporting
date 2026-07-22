import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/dal";
import { requireEvidenceEntityAccess, type EvidenceEntityType } from "@/lib/data/evidence";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const evidenceIdSchema = z.string().uuid();

async function getEvidenceRecord(evidenceId: string, organisationId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("evidence_files")
    .select("id, entity_type, entity_id, evidence_type, storage_path, file_name")
    .eq("id", evidenceId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to open evidence." }, { status: 401 });
  const parsedId = evidenceIdSchema.safeParse((await params).evidenceId);
  if (!parsedId.success) return NextResponse.json({ error: "Evidence not found." }, { status: 404 });

  try {
    const evidence = await getEvidenceRecord(parsedId.data, profile.organisationId);
    if (!evidence) return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
    await requireEvidenceEntityAccess(profile, evidence.entity_type as EvidenceEntityType, evidence.entity_id, "read");
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from("management-evidence").createSignedUrl(evidence.storage_path, 60, {
      download: evidence.file_name,
    });
    if (error || !data?.signedUrl) return NextResponse.json({ error: "The secure download could not be created." }, { status: 500 });
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence not found." }, { status: 403 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to remove evidence." }, { status: 401 });
  const parsedId = evidenceIdSchema.safeParse((await params).evidenceId);
  if (!parsedId.success) return NextResponse.json({ error: "Evidence not found." }, { status: 404 });

  try {
    const evidence = await getEvidenceRecord(parsedId.data, profile.organisationId);
    if (!evidence) return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
    await requireEvidenceEntityAccess(profile, evidence.entity_type as EvidenceEntityType, evidence.entity_id, "write");
    const admin = createAdminClient();
    if (evidence.entity_type === "product_development" && evidence.evidence_type === "finished_photo") {
      const [{ data: product }, { count }] = await Promise.all([
        admin.from("product_development_items").select("status").eq("id", evidence.entity_id).eq("organisation_id", profile.organisationId).maybeSingle(),
        admin.from("evidence_files").select("id", { count: "exact", head: true }).eq("organisation_id", profile.organisationId).eq("entity_type", "product_development").eq("entity_id", evidence.entity_id).eq("evidence_type", "finished_photo").neq("id", evidence.id),
      ]);
      if (product?.status === "live" && (count ?? 0) === 0) {
        return NextResponse.json({ error: "A Live product must retain at least one finished-product photo. Move it out of Live before removing this evidence." }, { status: 409 });
      }
    }
    const { error: removeError } = await admin.storage.from("management-evidence").remove([evidence.storage_path]);
    if (removeError) return NextResponse.json({ error: `The stored file could not be removed: ${removeError.message}` }, { status: 500 });
    const { error: deleteError } = await admin.from("evidence_files").delete().eq("id", evidence.id).eq("organisation_id", profile.organisationId);
    if (deleteError) return NextResponse.json({ error: "The evidence record could not be removed." }, { status: 500 });
    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "evidence.deleted",
      entity_type: evidence.entity_type,
      entity_id: evidence.entity_id,
      detail: { evidence_id: evidence.id, file_name: evidence.file_name },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence could not be removed." }, { status: 403 });
  }
}

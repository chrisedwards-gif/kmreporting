import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/dal";
import {
  EVIDENCE_ENTITY_TYPES,
  EVIDENCE_TYPES,
  requireEvidenceEntityAccess,
} from "@/lib/data/evidence";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const uploadSchema = z.object({
  entityType: z.enum(EVIDENCE_ENTITY_TYPES),
  entityId: z.string().uuid(),
  evidenceType: z.enum(EVIDENCE_TYPES),
  caption: z.string().trim().max(500).default(""),
});

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

const safeFileName = (value: string) => {
  const clean = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 120) || "evidence-file";
};

export async function POST(request: Request) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to upload evidence." }, { status: 401 });

  try {
    const formData = await request.formData();
    const parsed = uploadSchema.safeParse({
      entityType: formData.get("entityType"),
      entityId: formData.get("entityId"),
      evidenceType: formData.get("evidenceType"),
      caption: formData.get("caption") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the evidence details." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Evidence files must be 10 MB or smaller." }, { status: 400 });
    }
    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json({ error: "Use an image, PDF, Word, Excel, CSV or text file." }, { status: 400 });
    }
    if (["finished_photo", "trial_photo", "check_photo"].includes(parsed.data.evidenceType) && !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "That evidence type requires an image file." }, { status: 400 });
    }

    const entity = await requireEvidenceEntityAccess(profile, parsed.data.entityType, parsed.data.entityId, "write");
    const admin = createAdminClient();
    const storagePath = [
      profile.organisationId,
      parsed.data.entityType,
      parsed.data.entityId,
      `${crypto.randomUUID()}-${safeFileName(file.name)}`,
    ].join("/");
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("management-evidence")
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: `The evidence file could not be uploaded: ${uploadError.message}` }, { status: 500 });
    }

    const { data: evidence, error: insertError } = await admin.from("evidence_files").insert({
      organisation_id: profile.organisationId,
      site_id: entity.siteId,
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId,
      evidence_type: parsed.data.evidenceType,
      file_name: file.name.slice(0, 240),
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
      caption: parsed.data.caption,
      uploaded_by: profile.id,
    }).select("id").single();

    if (insertError || !evidence) {
      await admin.storage.from("management-evidence").remove([storagePath]);
      return NextResponse.json({ error: "The file uploaded, but its evidence record could not be saved." }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      organisation_id: profile.organisationId,
      actor_id: profile.id,
      action: "evidence.uploaded",
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId,
      detail: {
        evidence_id: evidence.id,
        evidence_type: parsed.data.evidenceType,
        file_name: file.name.slice(0, 240),
        size_bytes: file.size,
      },
    });

    return NextResponse.json({ id: evidence.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The evidence file could not be uploaded." }, { status: 400 });
  }
}

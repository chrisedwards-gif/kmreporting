import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const EVIDENCE_ENTITY_TYPES = [
  "product_development",
  "sop",
  "training_record",
  "kitchen_check_run",
  "probation_review",
] as const;

export const EVIDENCE_TYPES = [
  "finished_photo",
  "trial_photo",
  "signed_document",
  "training_evidence",
  "check_photo",
  "supporting_document",
  "other",
] as const;

export type EvidenceEntityType = (typeof EVIDENCE_ENTITY_TYPES)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceFile = {
  id: string;
  entityType: EvidenceEntityType;
  entityId: string;
  evidenceType: EvidenceType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string;
  uploadedByName: string;
  createdAt: string;
};

type EvidenceRow = {
  id: string;
  entity_type: EvidenceEntityType;
  entity_id: string;
  evidence_type: EvidenceType;
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
  caption: string;
  uploaded_by: string | null;
  created_at: string;
};

export async function getEvidenceFiles(
  entityType: EvidenceEntityType,
  entityIds: string[],
): Promise<Record<string, EvidenceFile[]>> {
  if (!entityIds.length) return {};
  const supabase = await createServerSupabaseClient();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("evidence_files")
    .select("id, entity_type, entity_id, evidence_type, file_name, mime_type, size_bytes, caption, uploaded_by, created_at")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false });
  if (error || !data?.length) return {};

  const rows = data as EvidenceRow[];
  const uploaderIds = [...new Set(rows.flatMap((row) => row.uploaded_by ? [row.uploaded_by] : []))];
  const { data: uploaders } = uploaderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", uploaderIds)
    : { data: [] };
  const uploaderNames = new Map((uploaders ?? []).map((profile) => [profile.id, profile.full_name]));

  return rows.reduce<Record<string, EvidenceFile[]>>((result, row) => {
    const current = result[row.entity_id] ?? [];
    current.push({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      evidenceType: row.evidence_type,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      caption: row.caption,
      uploadedByName: row.uploaded_by ? uploaderNames.get(row.uploaded_by) ?? "Manager" : "Manager",
      createdAt: row.created_at,
    });
    result[row.entity_id] = current;
    return result;
  }, {});
}

type EvidenceEntity = {
  organisationId: string;
  siteId: string | null;
};

const entitySource: Record<EvidenceEntityType, { table: string; siteColumn: string | null }> = {
  product_development: { table: "product_development_items", siteColumn: "site_id" },
  sop: { table: "sops", siteColumn: "site_id" },
  training_record: { table: "training_records", siteColumn: "site_id" },
  kitchen_check_run: { table: "kitchen_check_runs", siteColumn: "site_id" },
  probation_review: { table: "probation_reviews", siteColumn: "site_id" },
};

export async function requireEvidenceEntityAccess(
  profile: SessionProfile,
  entityType: EvidenceEntityType,
  entityId: string,
  intent: "read" | "write",
): Promise<EvidenceEntity> {
  const source = entitySource[entityType];
  if (entityType === "probation_review") {
    if (!profile.capabilities.manageGroup) throw new Error("Probation evidence is restricted to group management.");
  } else if (intent === "write" && !profile.capabilities.maintainTrackers) {
    throw new Error("You do not have permission to manage evidence for this record.");
  }

  const admin = createAdminClient();
  const columns = entityType === "probation_review"
    ? `organisation_id, ${source.siteColumn}, status`
    : source.siteColumn ? `organisation_id, ${source.siteColumn}` : "organisation_id";
  const { data, error } = await admin
    .from(source.table)
    .select(columns)
    .eq("id", entityId)
    .eq("organisation_id", profile.organisationId)
    .maybeSingle();
  if (error || !data) throw new Error("The evidence record could not be found.");

  const row = data as unknown as Record<string, string | null>;
  const siteId = source.siteColumn ? row[source.siteColumn] ?? null : null;
  if (entityType === "probation_review" && intent === "write" && row.status === "finalised") {
    throw new Error("A finalised probation record and its evidence are immutable.");
  }
  if (profile.siteScopeIds !== null && (!siteId || !profile.siteScopeIds.includes(siteId))) {
    throw new Error("That evidence record is outside your assigned kitchen.");
  }

  return { organisationId: profile.organisationId, siteId };
}

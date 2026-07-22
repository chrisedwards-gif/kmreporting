import "server-only";

import { getEvidenceFiles, type EvidenceFile } from "@/lib/data/evidence";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SopCategory =
  | "stock_take" | "ordering" | "procure_wizard" | "waste" | "close_down"
  | "date_labelling" | "allergens" | "pizza_standards" | "prep_lists"
  | "cleaning" | "product_specifications" | "training" | "compliance" | "other";

export type SopStatus = "not_started" | "draft" | "in_review" | "live" | "reviewed" | "archived";

export type SopRecord = {
  id: string;
  siteId: string;
  siteName: string;
  title: string;
  category: SopCategory;
  priority: "high" | "medium" | "low";
  owner: string;
  status: SopStatus;
  dueDate: string | null;
  lastReviewedDate: string | null;
  nextReviewDate: string | null;
  version: number;
  documentLink: string;
  notes: string;
  evidence: EvidenceFile[];
};

export type TrainingRecord = {
  id: string;
  siteId: string;
  siteName: string;
  trainingDate: string;
  teamMember: string;
  topic: string;
  method: string;
  result: string;
  followUpRequired: boolean;
  followUpDate: string | null;
  signedOff: boolean;
  signedOffDate: string | null;
  signedOffByName: string;
  notes: string;
  evidence: EvidenceFile[];
};

export type TrackerSite = { id: string; name: string };

export async function getTrackerSites(): Promise<TrackerSite[]> {
  if (environment.isDemo) return [{ id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion" }];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("sites").select("id, name").eq("active", true).order("name");
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

export async function getSops(): Promise<SopRecord[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sops")
    .select("id, site_id, title, category, priority, owner, status, due_date, last_reviewed_date, next_review_date, version, document_link, notes")
    .neq("status", "archived")
    .order("status")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error || !data?.length) return [];
  const siteIds = [...new Set(data.map((row) => row.site_id))];
  const [{ data: sites }, evidenceBySop] = await Promise.all([
    supabase.from("sites").select("id, name").in("id", siteIds),
    getEvidenceFiles("sop", data.map((row) => row.id)),
  ]);
  const siteNames = new Map((sites ?? []).map((site) => [site.id, site.name]));
  return data.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    siteName: siteNames.get(row.site_id) ?? "Kitchen",
    title: row.title,
    category: row.category as SopCategory,
    priority: row.priority as SopRecord["priority"],
    owner: row.owner,
    status: row.status as SopStatus,
    dueDate: row.due_date,
    lastReviewedDate: row.last_reviewed_date,
    nextReviewDate: row.next_review_date,
    version: Number(row.version),
    documentLink: row.document_link,
    notes: row.notes,
    evidence: evidenceBySop[row.id] ?? [],
  }));
}

export async function getTrainingRecords(): Promise<TrainingRecord[]> {
  if (environment.isDemo) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("training_records")
    .select("id, site_id, training_date, team_member, topic, method, result, follow_up_required, follow_up_date, signed_off, signed_off_date, signed_off_by, notes")
    .order("training_date", { ascending: false })
    .limit(500);
  if (error || !data?.length) return [];
  const siteIds = [...new Set(data.map((row) => row.site_id))];
  const signerIds = [...new Set(data.flatMap((row) => row.signed_off_by ? [row.signed_off_by] : []))];
  const [siteResult, signerResult, evidenceByRecord] = await Promise.all([
    supabase.from("sites").select("id, name").in("id", siteIds),
    signerIds.length ? supabase.from("profiles").select("id, full_name").in("id", signerIds) : Promise.resolve({ data: [] }),
    getEvidenceFiles("training_record", data.map((row) => row.id)),
  ]);
  const siteNames = new Map((siteResult.data ?? []).map((site) => [site.id, site.name]));
  const signerNames = new Map((signerResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
  return data.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    siteName: siteNames.get(row.site_id) ?? "Kitchen",
    trainingDate: row.training_date,
    teamMember: row.team_member,
    topic: row.topic,
    method: row.method,
    result: row.result,
    followUpRequired: row.follow_up_required,
    followUpDate: row.follow_up_date,
    signedOff: row.signed_off,
    signedOffDate: row.signed_off_date,
    signedOffByName: row.signed_off_by ? signerNames.get(row.signed_off_by) ?? "Manager" : "",
    notes: row.notes,
    evidence: evidenceByRecord[row.id] ?? [],
  }));
}

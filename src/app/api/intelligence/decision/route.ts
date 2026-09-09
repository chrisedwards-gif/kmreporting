import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionProfile } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  signalId: z.uuid(),
  intent: z.enum(["accept", "dismiss", "measuring", "resolved"]),
  ownerProfileId: z.uuid().optional(),
  dueDate: z.iso.date().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireSessionProfile();
  if (!(["admin", "group_manager"] as string[]).includes(profile.actualRole) || profile.isAccessPreview) {
    return NextResponse.json({ error: "Only group management can change decision status." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The decision update is not valid." }, { status: 400 });
  const admin = createAdminClient();
  const { data: signal, error } = await admin.from("weekly_decision_signals")
    .select("id, organisation_id, site_id, category, severity, title, finding, recommendation, confidence, estimated_weekly_impact, status")
    .eq("id", parsed.data.signalId)
    .eq("organisation_id", profile.organisationId)
    .maybeSingle();
  if (error || !signal) return NextResponse.json({ error: "That decision is no longer available." }, { status: 404 });

  if (parsed.data.intent === "dismiss") {
    await admin.from("weekly_decision_signals").update({ status: "dismissed", updated_at: new Date().toISOString() }).eq("id", signal.id);
    await audit(admin, profile.organisationId, profile.id, signal.id, "decision.dismissed", parsed.data.note);
    return NextResponse.json({ ok: true, status: "dismissed" });
  }
  if (parsed.data.intent === "measuring" || parsed.data.intent === "resolved") {
    const nextStatus = parsed.data.intent === "resolved" ? "resolved" : "measuring";
    await admin.from("weekly_decision_signals").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", signal.id);
    await audit(admin, profile.organisationId, profile.id, signal.id, `decision.${nextStatus}`, parsed.data.note);
    return NextResponse.json({ ok: true, status: nextStatus });
  }

  let ownerProfileId = parsed.data.ownerProfileId ?? null;
  if (!ownerProfileId && signal.site_id) {
    const { data: assignment } = await admin.from("site_manager_assignments")
      .select("manager_profile_id")
      .eq("site_id", signal.site_id)
      .eq("assignment_role", "primary")
      .is("ends_on", null)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    ownerProfileId = assignment?.manager_profile_id ?? null;
  }
  if (!ownerProfileId) ownerProfileId = profile.id;
  const { data: owner } = await admin.from("profiles").select("id, full_name, active").eq("id", ownerProfileId).eq("organisation_id", profile.organisationId).maybeSingle();
  if (!owner?.active) return NextResponse.json({ error: "Choose an active owner for this action." }, { status: 409 });

  const defaultDue = new Date();
  defaultDue.setUTCDate(defaultDue.getUTCDate() + 14);
  const dueDate = parsed.data.dueDate ?? defaultDue.toISOString().slice(0, 10);
  const actionText = `${signal.title}: ${signal.recommendation}`.slice(0, 1500);
  const successMeasure = measurementFor(signal.category, signal.finding);
  const { data: action, error: actionError } = await admin.from("manager_actions").insert({
    organisation_id: profile.organisationId,
    manager_id: owner.id,
    manager_profile_id: owner.id,
    site_id: signal.site_id,
    priority: signal.severity === "risk" ? "high" : "medium",
    action: actionText,
    success_measure: successMeasure,
    owner: owner.full_name,
    due_date: dueDate,
    status: "not_started",
    outcome: parsed.data.note ?? "",
    source_decision_signal_id: signal.id,
  }).select("id").single();
  if (actionError) {
    if (actionError.code === "23505") {
      const { data: existing } = await admin.from("manager_actions").select("id").eq("source_decision_signal_id", signal.id).maybeSingle();
      await admin.from("weekly_decision_signals").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", signal.id);
      return NextResponse.json({ ok: true, status: "accepted", actionId: existing?.id ?? null, alreadyExists: true });
    }
    return NextResponse.json({ error: "The decision could not be added to the Action Log." }, { status: 500 });
  }
  await admin.from("weekly_decision_signals").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", signal.id);
  await audit(admin, profile.organisationId, profile.id, signal.id, "decision.accepted", parsed.data.note, action.id);
  return NextResponse.json({ ok: true, status: "accepted", actionId: action.id });
}

function measurementFor(category: string, finding: string) {
  const prefix = finding.slice(0, 240);
  if (category === "pricing") return `Baseline: ${prefix} Measure for two comparable weeks: units sold, realised unit value, revenue and contribution. Keep only if contribution improves without unacceptable volume loss.`;
  if (category === "menu") return `Baseline: ${prefix} Measure for two to four weeks: unit volume, contribution, waste/prep burden and sales transfer to substitute products.`;
  if (category === "labour") return `Baseline: ${prefix} Measure on comparable days: labour %, sales per staffed hour, service/ticket-time feedback and any stayed-late/understaffed evidence.`;
  if (category === "food_cost" || category === "procurement") return `Baseline: ${prefix} Reconcile purchasing/credits first, then compare food cost/spend and £ variance over the next two reporting weeks.`;
  if (category === "waste") return `Baseline: ${prefix} Measure weekly waste £/% and the specific waste cause for two reporting weeks.`;
  return `Baseline: ${prefix} Record the chosen change and compare the same KPI over the next two comparable reporting weeks.`;
}

async function audit(admin: ReturnType<typeof createAdminClient>, organisationId: string, actorId: string, signalId: string, action: string, note?: string, actionId?: string) {
  await admin.from("audit_log").insert({
    organisation_id: organisationId,
    actor_id: actorId,
    action,
    entity_type: "weekly_decision_signal",
    entity_id: signalId,
    detail: { note: note ?? "", action_id: actionId ?? null },
  });
}

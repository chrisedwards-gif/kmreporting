import "server-only";

import { environment } from "@/lib/env";
import type { StoredRotaPlan } from "@/lib/data/rotas";
import type { ExternalRotaSignals } from "@/lib/rota/external-signals";

type StaffTarget = { id: string; name: string; minimumHours: number; targetHours: number; maximumHours: number };

export async function getRotaAiReview(plan: StoredRotaPlan | null, signals: ExternalRotaSignals, staffTargets: StaffTarget[]) {
  if (!plan || !environment.aiApiKey || !environment.aiProvider) return null;

  const staffHours = staffTargets.map((staff) => ({
    name: staff.name,
    minimumHours: staff.minimumHours,
    targetHours: staff.targetHours,
    maximumHours: staff.maximumHours,
    plannedHours: plan.days.flatMap((day) => day.shifts).filter((shift) => shift.staffProfileId === staff.id).reduce((sum, shift) => sum + shift.paidMinutes / 60, 0),
  }));
  const safePlan = {
    weekStart: plan.weekStart,
    forecastSales: plan.forecastSales,
    forecastRange: [plan.forecastLow, plan.forecastHigh],
    labourTargetPct: plan.labourTargetPct,
    labourBudget: plan.labourBudget,
    plannedCost: plan.plannedCost,
    plannedHours: plan.plannedHours,
    confidence: plan.confidence,
    warnings: plan.warnings,
    days: plan.days.map((day) => ({
      date: day.businessDate,
      forecastSales: day.forecastSales,
      labourBudget: day.labourBudget,
      plannedCost: day.plannedCost,
      plannedHours: day.plannedHours,
      peakTime: day.peakTime,
      coverageShortfalls: day.coverage.filter((slot) => slot.assigned < slot.required),
      shifts: day.shifts.map((shift) => ({ staffName: shift.staffName, role: shift.roleTitle, start: shift.shiftStart, end: shift.shiftEnd, paidHours: shift.paidMinutes / 60, requiredSkill: shift.requiredSkill })),
    })),
    staffHours,
    weather: signals.weather,
    nearbyEvents: signals.events,
  };

  try {
    const response = await fetch(`${environment.aiBaseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${environment.aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: environment.aiModel,
        instructions: "You are reviewing a restaurant kitchen rota suggestion. Never change or dismiss hard constraints. Give a concise operational review with: 1) top three risks, 2) hours/fairness concern, 3) weather or event consideration, 4) the single best manager action. Do not infer facts not present. Do not mention individual pay.",
        input: JSON.stringify(safePlan),
        max_output_tokens: 500,
        ...(environment.aiProvider === "openai" ? { store: false } : {}),
      }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    return payload.output_text?.trim() || payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim() || null;
  } catch {
    return null;
  }
}
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/dal";
import { environment } from "@/lib/env";

const contextSchema = z.object({
  weekStart: z.string().max(20),
  forecastSales: z.number().nonnegative(),
  forecastRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  labourTargetPct: z.number().nonnegative(),
  labourBudget: z.number().nonnegative(),
  plannedCost: z.number().nonnegative(),
  plannedHours: z.number().nonnegative(),
  confidence: z.union([z.string(), z.number()]).optional(),
  warnings: z.array(z.string().max(500)).max(50),
  days: z.array(z.object({
    date: z.string().max(20),
    forecastSales: z.number().nonnegative(),
    labourBudget: z.number().nonnegative(),
    plannedCost: z.number().nonnegative(),
    plannedHours: z.number().nonnegative(),
    peakTime: z.string().nullable(),
    coverageShortfalls: z.array(z.object({
      time: z.string().max(20),
      assigned: z.number().nonnegative(),
      required: z.number().nonnegative(),
      requiredSkills: z.array(z.string().max(100)).max(20).optional(),
    })).max(100),
    shifts: z.array(z.object({
      staffName: z.string().max(120),
      role: z.string().max(120),
      start: z.string().max(40),
      end: z.string().max(40),
      paidHours: z.number().nonnegative(),
      requiredSkill: z.string().nullable().optional(),
      suggestedBreak: z.string().nullable().optional(),
    })).max(100),
  })).max(7),
  staffHours: z.array(z.object({
    name: z.string().max(120),
    minimumHours: z.number().nonnegative(),
    targetHours: z.number().nonnegative(),
    maximumHours: z.number().nonnegative(),
    plannedHours: z.number().nonnegative(),
  })).max(100),
  weather: z.array(z.record(z.string(), z.unknown())).max(14),
  nearbyEvents: z.array(z.record(z.string(), z.unknown())).max(100),
});

const requestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  context: contextSchema,
});

const extractText = (payload: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }) =>
  payload.output_text?.trim()
  || payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim()
  || "";

type OpenAiErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string | null;
  };
};

function publicOpenAiError(status: number, payload: OpenAiErrorPayload) {
  const code = payload.error?.code ?? payload.error?.type ?? "unknown";
  if (status === 401) return "OpenAI rejected the API key. Create a new project API key and replace OPENAI_API_KEY in Vercel.";
  if (status === 403) return "The OpenAI key does not have permission to use the Responses API or selected model.";
  if (status === 404) return `The configured OpenAI model (${environment.openaiModel}) is not available to this API project.`;
  if (status === 429 && (code === "insufficient_quota" || code === "billing_not_active")) {
    return "The OpenAI API project has no available credit or active billing. ChatGPT Plus does not include API usage.";
  }
  if (status === 429) return "OpenAI is rate-limiting this project. Wait briefly and try again.";
  if (status === 400) return "OpenAI rejected the rota request format. The server log now contains the exact reason.";
  return `OpenAI returned an error (${status}). Try again after checking the API project status.`;
}

export async function POST(request: NextRequest) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "group_manager", "kitchen_manager"].includes(profile.actualRole)) {
    return NextResponse.json({ error: "Rota copilot is not available for this role." }, { status: 403 });
  }
  if (!environment.openaiApiKey) {
    return NextResponse.json({ error: "OpenAI is not configured for this deployment." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    console.error("rota copilot validation failed", { issues: parsed.error.issues });
    return NextResponse.json({ error: "Invalid copilot request." }, { status: 400 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: environment.openaiModel,
        instructions: [
          "You are the operations copilot for a restaurant kitchen rota.",
          "Answer only from the supplied rota context. Never invent performance history, skills, availability or legal conclusions.",
          "Hard constraints and calculations belong to the deterministic planner. Do not claim a proposed change is compliant unless the context proves it.",
          "When suggesting a change, state what must be rechecked: cover, skills, rest, agreed hours and labour cost.",
          "Do not discuss individual pay or infer private payroll data.",
          "Be direct, operational and concise. Use pounds and UK time conventions.",
        ].join(" "),
        input: JSON.stringify({ question: parsed.data.question, rota: parsed.data.context }),
        max_output_tokens: 700,
        store: false,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as OpenAiErrorPayload;
      console.error("rota copilot OpenAI request failed", {
        status: response.status,
        requestId: response.headers.get("x-request-id"),
        model: environment.openaiModel,
        type: payload.error?.type,
        code: payload.error?.code,
        message: payload.error?.message,
      });
      return NextResponse.json({ error: publicOpenAiError(response.status, payload) }, { status: 502 });
    }

    const answer = extractText(await response.json());
    if (!answer) return NextResponse.json({ error: "The copilot returned an empty response." }, { status: 502 });
    return NextResponse.json({ answer });
  } catch (error) {
    console.error("rota copilot request failed", error);
    return NextResponse.json({ error: "The copilot could not reach OpenAI right now." }, { status: 500 });
  }
}

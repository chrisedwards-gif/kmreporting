import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/dal";
import { environment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const acknowledgementSchema = z.object({
  reviewId: z.string().uuid("The review reference is invalid. Refresh the page and try again."),
  response: z.string().max(4000, "Keep the response below 4,000 characters.").default(""),
});

const friendlyDatabaseMessage = (message: string) => {
  const normalised = message.toLowerCase();
  if (normalised.includes("already been acknowledged")) {
    return "This review has already been acknowledged. Refresh to see the permanent response record.";
  }
  if (normalised.includes("only a finalised review") || normalised.includes("finalised")) {
    return "Only a finalised review can be acknowledged. Refresh and check its current status.";
  }
  if (normalised.includes("named manager") || normalised.includes("group management")) {
    return "This review can only be acknowledged by the named Kitchen Manager or group management.";
  }
  if (normalised.includes("sign in again")) {
    return "Your session expired before the acknowledgement was recorded. Sign in again; your typed comment has not been changed.";
  }
  if (normalised.includes("not found")) {
    return "This review could not be found in the current workspace. Refresh the review list and open it again.";
  }
  return "The acknowledgement could not be recorded. Your comment remains on this page so you can try again.";
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "The acknowledgement request was invalid." }, { status: 400 });
  }

  const parsed = acknowledgementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the acknowledgement and try again.",
    }, { status: 400 });
  }

  if (environment.isDemo) {
    return NextResponse.json({ status: "error", message: "1-1 acknowledgements are read-only in the demo workspace." }, { status: 403 });
  }

  try {
    const profile = await getSessionProfile();
    if (!profile) {
      return NextResponse.json({
        status: "error",
        message: "Your session expired before the acknowledgement was recorded. Sign in again; your typed comment has not been changed.",
      }, { status: 401 });
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({
        status: "error",
        message: "The database connection is unavailable. Your comment has not been submitted.",
      }, { status: 503 });
    }

    const { error } = await supabase.rpc("acknowledge_one_to_one", {
      target_review: parsed.data.reviewId,
      response: parsed.data.response,
    });

    if (error) {
      console.error("1-1 acknowledgement API failed", {
        code: error.code,
        reviewId: parsed.data.reviewId,
        actorId: profile.id,
        message: error.message,
      });
      return NextResponse.json({ status: "error", message: friendlyDatabaseMessage(error.message) }, { status: 400 });
    }

    return NextResponse.json({
      status: "success",
      message: parsed.data.response.trim()
        ? "Your acknowledgement and comment have been recorded."
        : "Your acknowledgement has been recorded.",
      reviewId: parsed.data.reviewId,
    });
  } catch (error) {
    console.error("Unexpected 1-1 acknowledgement API failure", {
      reviewId: parsed.data.reviewId,
      error,
    });
    return NextResponse.json({
      status: "error",
      message: "The acknowledgement hit an unexpected error. Your comment remains on this page; refresh once and try again.",
    }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { demoPersonaCookieName } from "@/lib/auth/dal";
import { environment } from "@/lib/env";

const personas = new Set(["admin", "kitchen_manager", "viewer"]);

export async function GET(request: Request, context: { params: Promise<{ role: string }> }) {
  if (!environment.isDemo) return new NextResponse("Not found", { status: 404 });
  const { role } = await context.params;
  if (!personas.has(role)) return new NextResponse("Unknown persona", { status: 404 });

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(demoPersonaCookieName, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 30,
  });
  return response;
}

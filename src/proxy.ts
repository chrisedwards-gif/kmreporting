import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const normaliseOrigin = (value: string | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

export async function proxy(request: NextRequest) {
  const canonicalOrigin = process.env.VERCEL_ENV === "preview"
    ? normaliseOrigin(process.env.UAT_CANONICAL_ORIGIN)
    : null;

  if (canonicalOrigin && request.nextUrl.origin !== canonicalOrigin) {
    const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin);
    return NextResponse.redirect(destination, 307);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, {
          ...options,
          path: "/",
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
        }));
      },
    },
  });

  await supabase.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

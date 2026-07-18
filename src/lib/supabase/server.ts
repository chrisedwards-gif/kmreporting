import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { environment } from "@/lib/env";

export async function createServerSupabaseClient() {
  if (!environment.supabaseUrl || !environment.supabasePublishableKey) return null;

  const cookieStore = await cookies();
  return createServerClient(environment.supabaseUrl, environment.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. src/proxy.ts refreshes the session.
        }
      },
    },
  });
}

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { environment } from "@/lib/env";

export function createAdminClient() {
  if (!environment.supabaseUrl || !environment.supabaseServiceRoleKey) {
    throw new Error("Supabase service-role environment is not configured.");
  }

  return createClient(environment.supabaseUrl, environment.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

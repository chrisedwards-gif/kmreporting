import "server-only";

const hasSupabaseEnvironment = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const environment = {
  isDemo: process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !hasSupabaseEnvironment,
  isPreview: process.env.VERCEL_ENV === "preview",
  hasSupabase: hasSupabaseEnvironment,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  cronSecret: process.env.CRON_SECRET,
  importSecret: process.env.IMPORT_SECRET,
  reminderWebhookUrl: process.env.REMINDER_WEBHOOK_URL,
};

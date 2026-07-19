import "server-only";

const hasSupabaseEnvironment = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const vercelEnvironment = process.env.VERCEL_ENV;
const isProduction = vercelEnvironment === "production";
const isPreview = vercelEnvironment === "preview";
const quickLoginEmail = process.env.UAT_QUICK_LOGIN_EMAIL?.trim().toLowerCase();
const quickLoginPassword = process.env.UAT_QUICK_LOGIN_PASSWORD;
const canonicalOrigin = process.env.UAT_CANONICAL_ORIGIN?.trim().replace(/\/$/, "");

export const environment = {
  isDemo: process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !hasSupabaseEnvironment,
  isPreview,
  isProduction,
  hasSupabase: hasSupabaseEnvironment,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  cronSecret: process.env.CRON_SECRET,
  importSecret: process.env.IMPORT_SECRET,
  reminderWebhookUrl: process.env.REMINDER_WEBHOOK_URL,
  reminderRecipientOverride: process.env.REMINDER_RECIPIENT_OVERRIDE?.trim().toLowerCase() || undefined,
  uatCanonicalOrigin: isPreview && canonicalOrigin?.startsWith("https://") ? canonicalOrigin : undefined,
  uatQuickLoginEmail: quickLoginEmail,
  uatQuickLoginPassword: quickLoginPassword,
  uatQuickLoginEnabled:
    !isProduction &&
    isPreview &&
    process.env.ENABLE_UAT_QUICK_LOGIN === "true" &&
    Boolean(quickLoginEmail && quickLoginPassword),
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim(),
  resendReplyTo: process.env.RESEND_REPLY_TO?.trim(),
};

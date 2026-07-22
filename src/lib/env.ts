import "server-only";

const hasSupabaseEnvironment = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const vercelEnvironment = process.env.VERCEL_ENV;
const netlifyContext = process.env.CONTEXT;
const isProduction = vercelEnvironment === "production" || netlifyContext === "production";
const isPreview =
  vercelEnvironment === "preview" ||
  netlifyContext === "deploy-preview" ||
  netlifyContext === "branch-deploy";
const quickLoginEmail = process.env.UAT_QUICK_LOGIN_EMAIL?.trim().toLowerCase();
const quickLoginPassword = process.env.UAT_QUICK_LOGIN_PASSWORD;
const canonicalOrigin = process.env.UAT_CANONICAL_ORIGIN?.trim().replace(/\/$/, "");
const demoRequested = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const groqApiKey = process.env.GROQ_API_KEY?.trim();
const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const aiProvider = groqApiKey ? "groq" : openaiApiKey ? "openai" : null;

export const environment = {
  isDemo: !isProduction && (demoRequested || !hasSupabaseEnvironment),
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
  rotacloudApiKey: process.env.ROTACLOUD_API_KEY?.trim(),
  rotaWeatherLatitude: numberFromEnv(process.env.ROTA_WEATHER_LATITUDE, 53.4808),
  rotaWeatherLongitude: numberFromEnv(process.env.ROTA_WEATHER_LONGITUDE, -2.2426),
  rotaEventsCity: process.env.ROTA_EVENTS_CITY?.trim() || "Manchester",
  ticketmasterApiKey: process.env.TICKETMASTER_API_KEY?.trim(),
  groqApiKey,
  openaiApiKey,
  aiProvider,
  aiApiKey: groqApiKey || openaiApiKey,
  aiBaseUrl: groqApiKey ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1",
  aiModel: groqApiKey
    ? process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b"
    : process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
};
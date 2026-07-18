-- Run after deploying the app and saving secrets in Supabase Vault:
--   app_base_url  e.g. https://kitchen-reports.example.com
--   cron_secret   same value as the app's CRON_SECRET
-- This hourly Monday/Tuesday job is timezone-safe: the endpoint sends manager
-- reminders at 09:00 and 12:00 Monday, then approval reminders at 10:00 Tuesday.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'hos-kitchen-report-reminders',
  '0 * * * 1,2',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

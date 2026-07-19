# Netlify UAT deployment

Netlify can run this full Next.js application through its maintained OpenNext adapter. Use this as a second UAT host while Vercel build capacity is unavailable.

## Create the site

1. In Netlify choose **Add new project → Import an existing project → GitHub**.
2. Select `chrisedwards-gif/kmreporting`.
3. Set the production branch to `agent/uat-003-source-imports` after UAT 013 is promoted, or use `agent/uat-013-sops-training-netlify` for the feature preview.
4. Netlify should read `netlify.toml` and use:
   - Build command: `npm run build`
   - Publish directory: `.next`
   - Node: `22`
5. Add the environment variables below before deploying.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_DEMO_MODE=false`

## Application features

Copy these from the Vercel Preview environment when used:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO`
- `REMINDER_RECIPIENT_OVERRIDE`
- `REMINDER_WEBHOOK_URL` only when retaining the legacy fallback
- `CRON_SECRET`
- `IMPORT_SECRET`

Do not copy `UAT_QUICK_LOGIN_PASSWORD` to a third-party deployment until the application has a platform-neutral UAT environment guard. Use the normal login on Netlify for this temporary host.

## Supabase Auth URLs

After the first Netlify deploy, add the assigned `https://<site>.netlify.app` origin to Supabase Authentication redirect URLs. Keep the existing Vercel UAT URL as well. Password-reset and invitation links must be allowed to return to both UAT hosts during the transition.

## Important limitation

The application itself will work, including SSR, Server Actions, Supabase Auth and Resend. Vercel Cron schedules do not move automatically. Reminder endpoints can still be run manually or from an external scheduler until one permanent hosting platform is selected.

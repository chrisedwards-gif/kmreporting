# UAT 010 — draft repair, preview auth, Resend and product development

## Database

- Migration 014 fixes the `save_one_to_one` ambiguity that prevented drafts from being inserted and revokes application access to the RLS maintenance helper.
- Migration 015 adds the first working Product Development Tracker with status history, cost fields, owners, kitchens and RLS.

## Preview-only login

Set these only for Vercel Preview:

- `ENABLE_UAT_QUICK_LOGIN=true`
- `UAT_QUICK_LOGIN_EMAIL=<dedicated UAT admin email>`
- `UAT_QUICK_LOGIN_PASSWORD=<dedicated UAT password>`
- `UAT_CANONICAL_ORIGIN=https://<stable UAT branch URL>`

The quick-login button is unavailable when `VERCEL_ENV=production`, credentials stay server-side and every use is audited.

## Resend

Set these server-side variables:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=HOS Kitchen Reports <reports@your-verified-domain>`
- optional `RESEND_REPLY_TO`
- retain `REMINDER_RECIPIENT_OVERRIDE` during UAT

Finalised 1-1s use Resend when configured, then fall back to the existing webhook. Without either provider, the notification remains queued.

## Smoke checks

1. Start a 1-1, enter one partial note and press **Save draft**.
2. Confirm the URL changes to `/one-to-ones/<uuid>` and the saved message appears.
3. Return to Manager 1-1s and reopen it under **Open drafts**.
4. Confirm the entered note remains.
5. Enable preview quick login and confirm the login page shows the UAT button only on Preview.
6. Sign in, close the browser, reopen the stable UAT origin and confirm the session remains.
7. Open Product Development, create a test item, move it from Idea to Trial planned and confirm its history/version remains.
8. Configure Resend with the UAT override, finalise a test 1-1 and confirm Notifications records the provider reference.

## Production controls

- Never set UAT quick-login variables in Production.
- Enable leaked-password protection in Supabase Auth before production launch.
- Verify the Resend domain and use a business sender with SPF, DKIM and DMARC.

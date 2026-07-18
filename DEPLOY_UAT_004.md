# UAT 004 — operations import repair and account self-service

This update fixes two defects found in review and closes the last workflow gap before kitchen teams are invited.

## What changed

1. **Migration `010_operations_import_repair_and_manual_purchases.sql`**
   - Recreates `public.import_operating_metrics`, which migration 006 did not restore. Environments repaired with 006 previously returned a 500 from `POST /api/imports/operations`.
   - Provider purchasing rollups now add the report's audited manual purchase total back onto `purchases`, so a webhook retry or nightly sync can no longer erase shop top-ups recorded through the weekly report.
   - Imports no longer modify approved or shared weeks. Signed-off figures are decision records; late daily metrics are stored but only apply while a report is in draft, submitted or review.
   - Separate domain imports from the same provider preserve previously imported sales, purchasing or waste values instead of zeroing unrelated domains.
2. **Password lifecycle**
   - `/auth/set-password` — invited managers and password-recovery users land here and choose a password before entering the app.
   - `/auth/forgot-password` — self-service reset from the sign-in screen. The response never reveals whether an email has an account.
   - `/auth/callback` accepts a `next` parameter restricted to same-origin paths and supports both PKCE recovery codes and server-readable token hashes.
   - Auth emails derive an origin from request headers with Vercel deployment variables as a fallback, avoiding null redirect URLs in proxied Server Actions.

## Deploy in this order

1. Back up the Supabase project.
2. Apply migration `010` in the SQL Editor, or with `supabase db push`. It runs in a transaction and is safe to rerun. Migrations 006 and 008 must already be applied.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed app origin and add:

   ```text
   https://YOUR_DEPLOYED_APP/auth/callback
   ```

   to the redirect allow list.

4. Use the configured **Site URL** directly in the email templates. This is more robust than rendering `.RedirectTo`, which can be null when a proxy/runtime omits request host information.

   **Invite user**

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password">Accept invitation</a>
   ```

   **Reset password**

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password">Choose a new password</a>
   ```

5. Deploy the app build. `NEXT_PUBLIC_APP_URL` is an optional explicit fallback; Vercel Preview also supplies its deployment URL automatically.

## Smoke checks

- `POST /api/imports/operations` with a valid payload returns `200 { ok: true }`.
- Save a weekly report with a manual purchase, then re-send the week's purchasing metrics through the operations endpoint: the safe snapshot's purchases figure still includes the manual amount.
- Send sales and purchasing in separate imports using the same source system and business date: both domains remain present.
- After configuring the Invite user template above, invite a test kitchen manager from **Settings → Sites**: the email lands on *Choose your password*, and the account can sign out and back in with that password.
- *Forgotten your password?* on the sign-in screen delivers a reset email whose link opens the same set-password screen.
- `/auth/callback?next=//evil.example.com&code=x` never leaves the app's origin.

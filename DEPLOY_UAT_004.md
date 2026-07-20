# UAT 004–005 — operations hardening, account self-service and usability

This update fixes the final data-integrity and account-lifecycle defects found in UAT, then applies a focused usability pass across the weekly reporting workflow.

## What changed

1. **Migration `010_operations_import_repair_and_manual_purchases.sql`**
   - Recreates `public.import_operating_metrics`, which migration 006 did not restore. Environments repaired with 006 previously returned a 500 from `POST /api/imports/operations`.
   - Provider purchasing rollups now add the report's audited manual purchase total back onto `purchases`, so a webhook retry or nightly sync can no longer erase shop top-ups recorded through the weekly report.
   - Imports no longer modify approved or shared weeks. Signed-off figures are decision records; late daily metrics are stored but only apply while a report is in draft, submitted or review.
   - Separate domain imports from the same provider preserve previously imported sales, purchasing or waste values instead of zeroing unrelated domains.
2. **Password lifecycle**
   - `/auth/set-password` — invited managers and password-recovery users land here and choose a password before entering the app.
   - `/auth/forgot-password` — self-service reset from the sign-in screen. The response never reveals whether an email has an account.
   - `/auth/confirm` — scanner-safe one-time-code entry. The credential is not embedded in the email link, so Microsoft Safe Links cannot consume it during prefetching.
   - `/auth/callback` remains available for PKCE callback flows.
   - Auth emails derive an origin from request headers with Vercel deployment variables as a fallback, avoiding null redirect URLs in proxied Server Actions.
3. **UAT 005 usability and design pass**
   - Selecting the reporting Sunday now fills the Saturday automatically and invalid weeks cannot be submitted.
   - The report footer shows a live six-item readiness checklist instead of a vague status sentence.
   - Dashboard targets are sales-weighted and food, labour and waste metrics visibly flag when over target.
   - Kitchens without a report no longer link to a dead report route.
   - Auth, approval, cost and report-detail layouts use reusable BEM classes rather than remaining inline layout styles.
   - Keyboard users get a skip-to-content link, and money/hours inputs request decimal keypads on mobile.

## Deploy in this order

1. Back up the Supabase project.
2. Apply migration `010` in the SQL Editor, or with `supabase db push`. It runs in a transaction and is safe to rerun. Migrations 006 and 008 must already be applied.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed app origin.
4. Use one-time-code templates. These links contain no authentication token; the recipient manually enters the code shown in the same email.

   **Invite user**

   ```html
   <h2>You’ve been invited to HOS Kitchen Reports</h2>
   <p>Your one-time account code is:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?type=invite&email={{ .Email }}&next=/auth/set-password">Enter code and choose your password</a></p>
   ```

   **Reset password**

   ```html
   <h2>Reset your password</h2>
   <p>Your one-time reset code is:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?type=recovery&email={{ .Email }}&next=/auth/set-password">Enter code and reset your password</a></p>
   ```

   **Confirm signup**

   ```html
   <h2>Confirm your email address</h2>
   <p>Your one-time confirmation code is:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?type=email&email={{ .Email }}&next=/auth/set-password">Enter code and finish signing up</a></p>
   ```

5. Deploy the app build. `NEXT_PUBLIC_APP_URL` is an optional explicit fallback; Vercel Preview also supplies its deployment URL automatically.

## Smoke checks

- `POST /api/imports/operations` with a valid payload returns `200 { ok: true }`.
- Save a weekly report with a manual purchase, then re-send the week's purchasing metrics through the operations endpoint: the safe snapshot's purchases figure still includes the manual amount.
- Send sales and purchasing in separate imports using the same source system and business date: both domains remain present.
- Invite a test kitchen manager from **Settings → Sites**: the email shows a one-time code, the link opens the code-entry page, and the account can choose a password, sign out and sign back in.
- *Forgotten your password?* sends a one-time code that opens the same code-entry page and then the set-password screen.
- Microsoft Safe Links can prefetch the email link without invalidating the one-time code.
- Selecting a reporting Sunday fills the corresponding Saturday and the submit button remains disabled until all six readiness checks pass.
- A kitchen with no report displays a dash rather than a broken report link.

# Production status

The production database has been prepared, but `main` remains intentionally unchanged.

## Completed

- Separate London production Supabase project created and healthy.
- Canonical migration ledger applied through migration 019.
- Production organisation and kitchen configuration installed.
- Dough Religion daily and weekly kitchen-check templates installed.
- Test reports, test reviews and performance seed excluded.
- Production RLS and index hardening applied.
- Employee-level payroll ingestion disabled; aggregate labour imports remain enabled.
- Netlify Production context points at the production Supabase public endpoint.
- UAT quick login is disabled for Production.
- Fresh-database, lint, test and production-build pipelines pass.

## Private setup still required before merge

- Production server key entered in Netlify.
- Production import and scheduler secrets entered in Netlify.
- Verified Resend sender and API credential entered in Netlify.
- Final production URL added to Supabase Auth redirects.
- Initial production administrator invited and linked to the canonical admin profile.
- Production login, password reset and email delivery smoke tests passed.

PR #1 must remain draft and `main` must not be merged until those private steps are complete.

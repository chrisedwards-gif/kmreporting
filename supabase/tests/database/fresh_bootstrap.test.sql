begin;

select plan(37);

select has_table('public', 'organisations', 'Base organisation table exists');
select has_table('public', 'weekly_reports', 'Weekly reporting schema exists');
select has_table('public', 'site_manager_assignments', 'Canonical manager assignments exist');
select has_table('public', 'one_to_one_reviews', 'Manager 1-1 reviews exist');
select has_table('public', 'product_development_items', 'Product development tracker exists');
select has_table('public', 'kitchen_check_templates', 'Kitchen check templates exist');
select has_table('public', 'sops', 'SOP register exists');
select has_table('public', 'sop_versions', 'Immutable SOP versions exist');
select has_table('public', 'training_records', 'Training tracker exists');
select has_table('public', 'waste_log_entries', 'Daily waste log exists');
select has_table('public', 'management_email_settings', 'Weekly management email settings exist');
select has_table('payroll_private', 'salary_allocations', 'Private salary allocations exist');
select has_table('public', 'evidence_files', 'Private evidence register exists');
select has_table('public', 'rag_overrides', 'Audited RAG override register exists');
select has_table('public', 'probation_reviews', 'Probation decision records exist');
select ok(
  exists (select 1 from storage.buckets where id = 'management-evidence' and public = false),
  'Management evidence bucket is private'
);
select ok(
  to_regprocedure('public.set_rag_override(text,uuid,text,text,text,text)') is not null,
  'RAG override RPC exists'
);
select ok(
  to_regprocedure('public.revoke_rag_override(uuid,text)') is not null,
  'RAG override removal RPC exists'
);
select ok(
  to_regprocedure('public.save_probation_review(jsonb)') is not null,
  'Probation draft RPC exists'
);
select ok(
  to_regprocedure('public.finalise_probation_review(uuid,jsonb,numeric,text)') is not null,
  'Probation finalisation RPC exists'
);
select has_column('public', 'product_development_items', 'method_text', 'Product method is stored');
select has_column('public', 'product_development_items', 'shelf_life_text', 'Product shelf-life control is stored');
select has_column('public', 'product_development_items', 'operational_plan', 'Product operational plan is stored');

select ok(
  to_regprocedure('public.save_weekly_report_v2(jsonb)') is not null,
  'Weekly report save RPC exists'
);
select ok(
  to_regprocedure('public.save_one_to_one(jsonb)') is not null,
  '1-1 draft save RPC exists'
);
select ok(
  to_regprocedure('public.acknowledge_one_to_one(uuid,text)') is not null,
  'Response-aware 1-1 acknowledgement RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.acknowledge_one_to_one(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.acknowledge_one_to_one(uuid,text)', 'EXECUTE'),
  'Only authenticated accounts can call the acknowledgement RPC'
);
select ok(
  position('isNew' in pg_get_functiondef('public.save_one_to_one(jsonb)'::regprocedure)) > 0,
  '1-1 autosave uses idempotent client-generated action IDs'
);
select ok(
  to_regprocedure('public.save_kitchen_check(jsonb)') is not null,
  'Kitchen check save RPC exists'
);
select ok(
  to_regprocedure('public.save_sop(jsonb)') is not null,
  'SOP save RPC exists'
);
select ok(
  to_regprocedure('public.delete_unused_site(uuid,text)') is not null,
  'Safe unused-kitchen deletion RPC exists'
);
select ok(
  to_regprocedure('public.get_reporting_comparison(uuid,date,date)') is not null,
  'Historical comparison RPC exists'
);
select ok(
  to_regprocedure('public.save_waste_entry(jsonb)') is not null,
  'Daily waste save RPC exists'
);
select ok(
  to_regprocedure('public.get_report_support_summary(uuid,date,date,uuid)') is not null,
  'Safe report support summary RPC exists'
);
select ok(
  to_regprocedure('public.get_salary_allocations()') is not null,
  'Private salary register RPC exists'
);
select ok(
  to_regprocedure('public.save_salary_allocation(jsonb)') is not null,
  'Private salary save RPC exists'
);
select ok(
  (select count(*) >= 5 from public.sites)
    and exists (
      select 1
      from public.kitchen_check_templates template
      join public.sites site on site.id = template.site_id
      where lower(trim(site.name)) = 'dough religion'
    ),
  'All configured seeds apply after the migration chain'
);

select * from finish();
rollback;

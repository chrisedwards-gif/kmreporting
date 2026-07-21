begin;

select plan(16);

select has_table('public', 'organisations', 'Base organisation table exists');
select has_table('public', 'weekly_reports', 'Weekly reporting schema exists');
select has_table('public', 'site_manager_assignments', 'Canonical manager assignments exist');
select has_table('public', 'one_to_one_reviews', 'Manager 1-1 reviews exist');
select has_table('public', 'product_development_items', 'Product development tracker exists');
select has_table('public', 'kitchen_check_templates', 'Kitchen check templates exist');
select has_table('public', 'sops', 'SOP register exists');
select has_table('public', 'sop_versions', 'Immutable SOP versions exist');
select has_table('public', 'training_records', 'Training tracker exists');

select ok(
  to_regprocedure('public.save_weekly_report_v2(jsonb)') is not null,
  'Weekly report save RPC exists'
);
select ok(
  to_regprocedure('public.save_one_to_one(jsonb)') is not null,
  '1-1 draft save RPC exists'
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

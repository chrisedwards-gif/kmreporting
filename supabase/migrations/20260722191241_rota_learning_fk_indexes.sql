begin;

create index rota_daily_labour_history_organisation_idx
  on public.rota_daily_labour_history(organisation_id);
create index rota_shift_feedback_organisation_idx
  on public.rota_shift_feedback(organisation_id);

commit;

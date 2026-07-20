-- Seed Dough Religion's site-specific daily and weekly checks.
-- Generated from Dough_Religion_Weekly_Audit.xlsm for the weekly audit.

do $$
declare
  target_site uuid;
  target_org uuid;
  actor uuid;
  weekly_template uuid;
  daily_template uuid;
  section_id uuid;
  current_section text := '';
  item jsonb;
begin
  select site.id, site.organisation_id
    into target_site, target_org
  from public.sites site
  where lower(trim(site.name)) = 'dough religion'
  order by site.created_at
  limit 1;

  if target_site is null then
    raise notice 'Dough Religion site not found; kitchen check seed skipped.';
    return;
  end if;

  select profile.id into actor
  from public.profiles profile
  where profile.organisation_id = target_org
    and profile.role in ('admin', 'group_manager')
    and profile.active
  order by case when profile.role = 'admin' then 0 else 1 end, profile.created_at
  limit 1;

  insert into public.kitchen_check_templates (
    organisation_id, site_id, name, description, cadence,
    require_actions, pass_threshold, watch_threshold, version, active, created_by
  ) values (
    target_org,
    target_site,
    'Weekly Kitchen Audit',
    'Main kitchen, back fridge / walk-in and dry store. Green / Amber / Red scoring with automatic critical fail.',
    'weekly',
    true,
    90,
    75,
    1,
    true,
    actor
  )
  on conflict (site_id, name, version) do update set
    description = excluded.description,
    active = true,
    updated_at = now()
  returning id into weekly_template;

  delete from public.kitchen_check_sections where template_id = weekly_template;

  for item in
    select value from jsonb_array_elements('[{"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Temperature control", "standard": "Front fridge 1–5°C, freezer ≤ -18°C. Daily temps logged and in range. Probe clean and calibrated.", "critical": true, "sort": 1}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Date labelling & rotation", "standard": "Everything labelled with prep / use-by date. FIFO followed. No out-of-date or unlabelled stock.", "critical": true, "sort": 2}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Raw / ready-to-eat separation", "standard": "Raw proteins stored below and apart from prepped / ready-to-eat food. No cross-contamination risk.", "critical": true, "sort": 3}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Containers & covering", "standard": "All food in clean, food-grade, sealed or covered containers. Nothing open or uncovered.", "critical": false, "sort": 4}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Cleanliness & touch points", "standard": "Shelves, runners, seals, handles and high-touch points clean. No spills, residue or odour.", "critical": false, "sort": 5}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Larder / Front Fridge", "title": "Allergens", "standard": "Allergen items identified and stored to prevent contact. Decanting done safely and labelled.", "critical": true, "sort": 6}, {"main": "SECTION A — MAIN KITCHEN", "sub": "PASS — service", "title": "Date labelling & rotation", "standard": "Prepped components dated, in date and rotated. Nothing past use-by on the pass.", "critical": true, "sort": 7}, {"main": "SECTION A — MAIN KITCHEN", "sub": "PASS — service", "title": "Cleanliness & touch points", "standard": "Pass surfaces, gantry, screens, handles and switches clean. No debris or build-up.", "critical": false, "sort": 8}, {"main": "SECTION A — MAIN KITCHEN", "sub": "PASS — service", "title": "Cross-contamination control", "standard": "Clean / dirty flow respected. Colour-coded boards & utensils. No raw over ready-to-eat.", "critical": true, "sort": 9}, {"main": "SECTION A — MAIN KITCHEN", "sub": "PASS — service", "title": "Organisation & readiness", "standard": "Mise en place to par, labelled and tidy. Nothing stored on the floor.", "critical": false, "sort": 10}, {"main": "SECTION A — MAIN KITCHEN", "sub": "PASS — service", "title": "Allergens", "standard": "Allergen dishes identified. Separate utensils used. No cross-contact during service.", "critical": true, "sort": 11}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Temperature control", "standard": "Prep fridge / topping well 1–5°C. Dough proving controlled. Temps logged and in range.", "critical": true, "sort": 12}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Date labelling & rotation", "standard": "Toppings and dough dated. FIFO followed. Nothing out of date.", "critical": true, "sort": 13}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Cleanliness & touch points", "standard": "Bench, prep well, peels, screens and handles clean. No flour build-up or debris.", "critical": false, "sort": 14}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Oven & oven glass", "standard": "Oven clean, oven glass / door clear, deck / stone clean. No heavy carbon build-up.", "critical": false, "sort": 15}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Organisation & par levels", "standard": "Toppings held to par, covered and tidy. Nothing on the floor.", "critical": false, "sort": 16}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Pizza station", "title": "Allergens", "standard": "Allergen toppings / flour controlled. Gluten-free handled safely. No cross-contact.", "critical": true, "sort": 17}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Fryers & oil management", "standard": "Fryers clean, oil filtered and in date, no carbon build-up. Temperatures correct.", "critical": false, "sort": 18}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Ovens, ranges & oven glass", "standard": "Ovens, ranges and salamander clean. Oven glass clear. No grease build-up.", "critical": false, "sort": 19}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Extraction canopy & filters", "standard": "Canopy clean, filters degreased and in place, ductwork serviced and in date.", "critical": true, "sort": 20}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Drains, gullies & floors", "standard": "Drains and gullies clear, clean and odour-free. Floors degreased. No standing water.", "critical": true, "sort": 21}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Bins emptied and relined", "standard": "Bins emptied, cleaned and relined. Lids closing. No overflow or odour.", "critical": false, "sort": 22}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Walls, ceilings & high-level", "standard": "Walls, ceilings, splashbacks and high-level clean. No grease. Lighting clean and working.", "critical": false, "sort": 23}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Cookline, Extraction & Drains", "title": "Equipment & touch points", "standard": "Small equipment, switches, handles and probes clean and calibrated.", "critical": false, "sort": 24}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Prep Room", "title": "Floors clean", "standard": "Floors clean and degreased. No debris, spillage or standing water.", "critical": false, "sort": 25}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Prep Room", "title": "Surfaces clean", "standard": "Work surfaces, tables and benches clean and sanitised.", "critical": false, "sort": 26}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Prep Room", "title": "Organised & tidy", "standard": "Room organised and tidy. Equipment stored correctly. Nothing on the floor.", "critical": false, "sort": 27}, {"main": "SECTION A — MAIN KITCHEN", "sub": "Prep Room", "title": "Mixer clean", "standard": "Mixer(s) and attachments clean — no old product build-up. Guards in place and working.", "critical": false, "sort": 28}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Temperature control", "standard": "Fridge 1–5°C, freezer ≤ -18°C. Daily temps logged and in range. Probe clean and calibrated.", "critical": true, "sort": 29}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Date labelling & rotation", "standard": "Everything labelled with prep / use-by date. FIFO followed. No out-of-date or unlabelled stock.", "critical": true, "sort": 30}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Raw / ready-to-eat separation", "standard": "Raw proteins stored below and apart from prepped / ready-to-eat food. No cross-contamination risk.", "critical": true, "sort": 31}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Containers & covering", "standard": "All food in clean, food-grade, sealed or covered containers. Nothing open or left in opened tins.", "critical": false, "sort": 32}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Organisation & layout", "standard": "Logical, tidy layout. Not overpacked. Airflow clear. Shelves allocated and used consistently.", "critical": false, "sort": 33}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Cleanliness", "standard": "Shelves, runners, door seals, fans and floor clean. No spills, sticky residue, mould or odour.", "critical": false, "sort": 34}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Stock & par levels", "standard": "Held to par. No excessive overstock, no gaps, no ageing stock or creeping waste.", "critical": false, "sort": 35}, {"main": "SECTION B — BACK FRIDGE / WALK-IN", "sub": null, "title": "Allergens", "standard": "Allergen items identified and stored to prevent contact (covered, separated). Decanting done safely.", "critical": true, "sort": 36}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Date labelling & rotation", "standard": "Opened goods dated. FIFO followed. No out-of-date stock on the shelves.", "critical": true, "sort": 37}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Organisation & labelling", "standard": "Everything in its place, labelled and neat. Decanted goods in correct, labelled containers.", "critical": false, "sort": 38}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Storage standards", "standard": "All stock off the floor, sealed, in food-grade containers. Packaging intact — no swollen or damaged tins.", "critical": true, "sort": 39}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Cleanliness", "standard": "Shelves, floor and surfaces clean. No spillages, loose product or debris.", "critical": false, "sort": 40}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Pest control", "standard": "No signs of pests (droppings, gnaw marks, webbing). Monitoring points present and checked. Gaps / doors sealed.", "critical": true, "sort": 41}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Stock control & overstock", "standard": "Correct lines held to par. No overstock, damaged packaging or obsolete items building up.", "critical": false, "sort": 42}, {"main": "SECTION C — DRY STORE", "sub": null, "title": "Allergens", "standard": "Allergen dry goods (e.g. flour, nuts) segregated / contained to prevent cross-contact. Spills cleaned at once.", "critical": true, "sort": 43}]'::jsonb)
  loop
    if current_section is distinct from item->>'main' then
      current_section := item->>'main';
      insert into public.kitchen_check_sections (
        template_id, title, sort_order
      ) values (
        weekly_template,
        replace(current_section, 'SECTION A — ', ''),
        case current_section
          when 'SECTION A — MAIN KITCHEN' then 1
          when 'SECTION B — BACK FRIDGE / WALK-IN' then 2
          else 3
        end
      ) returning id into section_id;
    end if;

    insert into public.kitchen_check_items (
      template_id, section_id, subgroup, title, standard,
      critical, required, max_points, sort_order
    ) values (
      weekly_template,
      section_id,
      nullif(item->>'sub', ''),
      item->>'title',
      item->>'standard',
      coalesce((item->>'critical')::boolean, false),
      true,
      2,
      (item->>'sort')::integer
    );
  end loop;

  insert into public.kitchen_check_templates (
    organisation_id, site_id, name, description, cadence,
    require_actions, pass_threshold, watch_threshold, version, active, created_by
  ) values (
    target_org,
    target_site,
    'Daily Kitchen Check',
    'Daily food-safety, service-readiness, close-down, stock and handover check for Dough Religion.',
    'daily',
    true,
    90,
    75,
    1,
    true,
    actor
  )
  on conflict (site_id, name, version) do update set
    description = excluded.description,
    active = true,
    updated_at = now()
  returning id into daily_template;

  delete from public.kitchen_check_sections where template_id = daily_template;
  current_section := '';

  for item in
    select value from jsonb_array_elements('[{"section": "Daily food safety", "title": "Temperature logs complete", "standard": "All required fridge and freezer temperatures have been recorded and are within range. Probes are clean and working.", "critical": true, "sort": 1}, {"section": "Daily food safety", "title": "Date labels and use-by", "standard": "All prepared and opened food is labelled, in date and rotated. No expired or unidentified food.", "critical": true, "sort": 2}, {"section": "Daily food safety", "title": "Raw / ready-to-eat separation", "standard": "Raw proteins are stored below and away from ready-to-eat food with no cross-contamination risk.", "critical": true, "sort": 3}, {"section": "Daily food safety", "title": "Allergen controls", "standard": "Allergen ingredients, dishes and utensils are identified and controlled with no cross-contact risk.", "critical": true, "sort": 4}, {"section": "Service readiness", "title": "Mise en place and par levels", "standard": "Sections are set to agreed par, organised and ready for service without excessive overproduction.", "critical": false, "sort": 5}, {"section": "Service readiness", "title": "Product quality", "standard": "Products, sauces, dough and garnishes meet specification and presentation standards.", "critical": false, "sort": 6}, {"section": "Service readiness", "title": "Equipment working safely", "standard": "Essential equipment is clean, assembled, switched on correctly and safe to use.", "critical": true, "sort": 7}, {"section": "Close-down", "title": "Food covered and stored", "standard": "All food is covered or sealed, stored correctly and returned to the correct labelled location.", "critical": true, "sort": 8}, {"section": "Close-down", "title": "Touch points and surfaces", "standard": "Benches, handles, screens, switches, seals and contact surfaces are cleaned and sanitised.", "critical": false, "sort": 9}, {"section": "Close-down", "title": "Floors, drains and grease trap", "standard": "Floors are swept and degreased; drains and grease trap are clear, emptied and odour-free.", "critical": true, "sort": 10}, {"section": "Close-down", "title": "Bins emptied and relined", "standard": "Bins are emptied, washed where required and relined with no overflow or odour.", "critical": false, "sort": 11}, {"section": "Close-down", "title": "Ovens, fryers and small equipment", "standard": "Ovens, glass, fryers, utensils and small equipment are cleaned to the daily standard.", "critical": false, "sort": 12}, {"section": "Stock and reporting", "title": "Waste recorded", "standard": "All food waste and production waste has been recorded accurately.", "critical": false, "sort": 13}, {"section": "Stock and reporting", "title": "Top-up purchases recorded", "standard": "Any shop top-ups or off-system purchases have been entered with value and receipt/evidence.", "critical": false, "sort": 14}, {"section": "Handover", "title": "Handover book updated", "standard": "Prep, orders, events, shortages, maintenance and important information are recorded for the next shift.", "critical": false, "sort": 15}, {"section": "Handover", "title": "Outstanding issues escalated", "standard": "Any unresolved food-safety, staffing, equipment or stock issue has an owner and has been escalated.", "critical": true, "sort": 16}]'::jsonb)
  loop
    if current_section is distinct from item->>'section' then
      current_section := item->>'section';
      insert into public.kitchen_check_sections (
        template_id, title, sort_order
      ) values (
        daily_template,
        current_section,
        case current_section
          when 'Daily food safety' then 1
          when 'Service readiness' then 2
          when 'Close-down' then 3
          when 'Stock and reporting' then 4
          else 5
        end
      ) returning id into section_id;
    end if;

    insert into public.kitchen_check_items (
      template_id, section_id, title, standard,
      critical, required, max_points, sort_order
    ) values (
      daily_template,
      section_id,
      item->>'title',
      item->>'standard',
      coalesce((item->>'critical')::boolean, false),
      true,
      2,
      (item->>'sort')::integer
    );
  end loop;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    target_org,
    actor,
    'kitchen_check.templates_seeded',
    'site',
    target_site,
    jsonb_build_object(
      'weekly_template_id', weekly_template,
      'weekly_items', 43,
      'daily_template_id', daily_template,
      'daily_items', 16
    )
  );
end;
$$;

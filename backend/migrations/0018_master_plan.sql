-- Диаметры по генплану (предварительная схема). Задание на проектирование
-- требует принять схему генплана за основу и обосновывать отклонения расчётом,
-- поэтому сами диаметры генплана обязаны храниться: без них сверять не с чем, а
-- расхождение проекта и схемы остаётся незамеченным до экспертизы.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog', 'title_block', 'master_plan'
  ));

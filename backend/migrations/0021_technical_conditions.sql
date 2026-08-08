-- Контрактные величины проекта: то, что задают технические условия.
--
-- Проектный диаметр спрашивался ДВАЖДЫ — отдельным полем в секции
-- реконструкции и отдельным в прогоне комплекта. Два независимых поля для
-- одной величины расходятся молча: инженер правит одно, второе остаётся
-- прежним, и два расчёта одного объекта дают разное.
--
-- Хранится не только значение, но и происхождение: величина из документа ТУ,
-- измеренная по чертежу или введённая руками — это разные основания, и в
-- аудите они не должны сливаться.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog', 'title_block', 'master_plan', 'vertical_plan',
    'gravity_basins', 'technical_conditions'
  ));

-- Проектные отметки вертикальной планировки.
--
-- Городской линейный объект проектируется от ПЛАНИРУЕМОЙ поверхности, а не от
-- существующего рельефа: схема вертикальной планировки задаёт отметки на
-- перекрёстках, и глубины заложения считаются от них. Пока отметок негде было
-- хранить, профиль строился по одной съёмке, а модуль их совмещения
-- (engine/src/norms/vertplan.ts) лежал без пути с экрана.
--
-- Хранятся отдельным видом, а не в 'topography': это разные поверхности, и
-- смешивать измеренное с проектным нельзя — по ним считаются разные величины.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog', 'title_block', 'master_plan', 'vertical_plan'
  ));

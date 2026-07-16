-- AquaScheme: initial permitting documents checklist (исходно-разрешительная
-- документация: ТЗ, АПЗ, ПДП, акт выбора трассы, схема генплана, топосъёмка,
-- отчёт ИГИ, вертикальная планировка, ТУ). Apply AFTER 0010. Idempotent.

alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis'
  ));

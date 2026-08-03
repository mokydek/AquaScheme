-- Организация и подписанты для основной надписи (ГОСТ Р 21.101-2020, форма 3,
-- графы 9–13). Модель штампа существовала, но графы заполнять было нечем:
-- данных организации и ответственных проект нигде не хранил.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog', 'title_block'
  ));

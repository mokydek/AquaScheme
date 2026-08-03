-- Каталог насосов ЛНС. Как и каталог колодцев, хранится JSONB в datasets:
-- марка, подача, напор и мощность зависят от завода, и встроенный список
-- попал бы в спецификацию проектной документации как неподтверждённый факт.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog'
  ));

-- Подтверждённая инженером разбивка трассы на самотёчные бассейны.
--
-- planGravityBasins даёт ПРЕДЛОЖЕНИЕ: куда ставить перекачку — вопрос
-- компоновки площадки, стоимости эксплуатации и согласований, и программа за
-- инженера его не решает. Но и держать решение негде было: неосуществимый
-- самотёк оставался стоп-фактором навсегда, и альбом объекта не собирался.
--
-- Хранится решение, а не расчёт: число перекачек и чем оно подтверждено.
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit',
    'manhole_catalog', 'pump_catalog', 'title_block', 'master_plan', 'vertical_plan',
    'gravity_basins'
  ));

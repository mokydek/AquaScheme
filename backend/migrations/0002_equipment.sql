-- AquaScheme: allow the equipment dataset kind (materials and fittings plan).
-- Apply in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table public.datasets drop constraint datasets_kind_check;

alter table public.datasets add constraint datasets_kind_check
  check (kind in ('topography', 'buildings', 'source', 'geology', 'seismic', 'normative', 'equipment'));

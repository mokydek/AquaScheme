-- AquaScheme: regions of Kazakhstan with regional design parameters
-- (requirements update 3, change 3). Apply AFTER 0005. Idempotent.
-- The engine code (engine/src/regions.ts) is the source of truth: the app
-- mirrors the list here on project open (upsert), the same convention as the
-- norm registry. Official seismic/freezing/rain values are pending from the
-- user, so every row starts unverified with null values.

-- ============================================================
-- 1. REGIONS (shared reference data)
-- ============================================================
create table if not exists public.regions (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('oblast', 'city')),
  center_lon double precision not null,
  center_lat double precision not null,
  seismic_points numeric,
  freezing_depth_m numeric,
  rain_params jsonb,
  hazards text[] not null default '{}',
  status text not null default 'unverified' check (status in ('verified', 'unverified'))
);
alter table public.regions enable row level security;

drop policy if exists "regions_read" on public.regions;
create policy "regions_read" on public.regions
  for select using (auth.uid() is not null);

drop policy if exists "regions_write" on public.regions;
create policy "regions_write" on public.regions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================
-- 2. Allow the region dataset kind (per project region selection)
-- ============================================================
alter table public.datasets drop constraint datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in ('topography', 'buildings', 'source', 'geology', 'seismic', 'normative', 'equipment', 'region'));

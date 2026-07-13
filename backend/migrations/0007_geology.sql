-- AquaScheme: geology module (requirements update 3, change 1).
-- Apply AFTER 0006. Idempotent: safe to re-run.
-- Geology becomes a full module: boreholes with coordinates and mouth
-- elevations, layers tied to engineering geological elements (ИГЭ), and the
-- groundwater table with aggressiveness per material. Project level
-- collapsibility, heaving, swelling and freezing depth live on the geology
-- dataset content; these tables hold the borehole data.

-- ============================================================
-- 1. BOREHOLES
-- ============================================================
create table if not exists public.geo_boreholes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text not null,
  x double precision,
  y double precision,
  mouth_elevation_m double precision,
  created_at timestamptz not null default now()
);
create index if not exists geo_boreholes_project_id_idx on public.geo_boreholes (project_id);
alter table public.geo_boreholes enable row level security;

drop policy if exists "geo_boreholes_all_own" on public.geo_boreholes;
create policy "geo_boreholes_all_own" on public.geo_boreholes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 2. LAYERS (per borehole, tied to an ИГЭ)
-- ============================================================
create table if not exists public.geo_layers (
  id uuid primary key default gen_random_uuid(),
  borehole_id uuid not null references public.geo_boreholes (id) on delete cascade,
  top_depth_m double precision not null,
  bottom_depth_m double precision not null,
  ige_code text,
  soil_name text,
  density_g_cm3 double precision,
  moisture_percent double precision,
  friction_angle_deg double precision,
  cohesion_kpa double precision,
  deformation_modulus_mpa double precision,
  filtration_m_day double precision,
  created_at timestamptz not null default now()
);
create index if not exists geo_layers_borehole_id_idx on public.geo_layers (borehole_id);
alter table public.geo_layers enable row level security;

drop policy if exists "geo_layers_all_own" on public.geo_layers;
create policy "geo_layers_all_own" on public.geo_layers
  for all using (
    exists (
      select 1 from public.geo_boreholes b
      where b.id = borehole_id and public.is_project_owner(b.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.geo_boreholes b
      where b.id = borehole_id and public.is_project_owner(b.project_id)
    )
  );

-- ============================================================
-- 3. GROUNDWATER (one record per borehole)
-- ============================================================
create table if not exists public.geo_water (
  id uuid primary key default gen_random_uuid(),
  borehole_id uuid not null references public.geo_boreholes (id) on delete cascade,
  depth_m double precision,
  aggressiveness_steel text check (aggressiveness_steel in ('low', 'medium', 'high')),
  aggressiveness_concrete text check (aggressiveness_concrete in ('low', 'medium', 'high')),
  aggressiveness_pe text check (aggressiveness_pe in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);
create index if not exists geo_water_borehole_id_idx on public.geo_water (borehole_id);
alter table public.geo_water enable row level security;

drop policy if exists "geo_water_all_own" on public.geo_water;
create policy "geo_water_all_own" on public.geo_water
  for all using (
    exists (
      select 1 from public.geo_boreholes b
      where b.id = borehole_id and public.is_project_owner(b.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.geo_boreholes b
      where b.id = borehole_id and public.is_project_owner(b.project_id)
    )
  );

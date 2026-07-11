-- AquaScheme: requirements update 1 (M1).
-- Apply AFTER 0000_full_schema.sql. Idempotent: safe to re-run.
-- Adds: work type and system type on projects, user material catalogs,
-- land parcels, existing networks and survey acts for reconstruction.

-- ============================================================
-- 1. PROJECTS: work type and system type (wizard steps 1 and 2)
-- ============================================================
alter table public.projects
  add column if not exists work_type text not null default 'new'
    check (work_type in ('new', 'reconstruction'));

alter table public.projects
  add column if not exists system_type text not null default 'water'
    check (system_type in ('water', 'sewer', 'storm'));

-- ============================================================
-- 2. CATALOGS: user uploaded material and fittings catalogs.
--    The built in catalog lives in the engine code and is NOT stored
--    here; projects.active_catalog_id NULL means "built in".
-- ============================================================
create table if not exists public.catalogs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  source_file text,
  created_at timestamptz not null default now()
);
create index if not exists catalogs_project_id_idx on public.catalogs (project_id);
alter table public.catalogs enable row level security;

drop policy if exists "catalogs_all_own" on public.catalogs;
create policy "catalogs_all_own" on public.catalogs
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs (id) on delete cascade,
  item_type text not null check (item_type in ('pipe', 'valve', 'hydrant', 'air_valve', 'check_valve', 'fitting')),
  material text,
  standard text,
  dn integer,
  outer_mm double precision,
  wall_mm double precision,
  sdr double precision,
  pn double precision,
  roughness_mm double precision,
  price numeric,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists catalog_items_catalog_id_idx on public.catalog_items (catalog_id);
alter table public.catalog_items enable row level security;

drop policy if exists "catalog_items_all_own" on public.catalog_items;
create policy "catalog_items_all_own" on public.catalog_items
  for all using (
    exists (
      select 1 from public.catalogs c
      where c.id = catalog_id and public.is_project_owner(c.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.catalogs c
      where c.id = catalog_id and public.is_project_owner(c.project_id)
    )
  );

alter table public.projects
  add column if not exists active_catalog_id uuid references public.catalogs (id) on delete set null;

-- ============================================================
-- 3. PARCELS: land plots of buildings and the route right of way.
--    geometry: GeoJSON Polygon in local project coordinates (meters).
-- ============================================================
create table if not exists public.parcels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  building_id uuid references public.buildings (id) on delete set null,
  label text,
  kind text not null default 'parcel' check (kind in ('parcel', 'right_of_way')),
  geometry jsonb not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists parcels_project_id_idx on public.parcels (project_id);
alter table public.parcels enable row level security;

drop policy if exists "parcels_all_own" on public.parcels;
create policy "parcels_all_own" on public.parcels
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 4. EXISTING NETWORKS (reconstruction): imported segments.
--    Existing manholes are stored as rows in nodes
--    (meta.origin = 'existing'); segments reference them.
-- ============================================================
create table if not exists public.existing_pipes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_node uuid not null references public.nodes (id) on delete cascade,
  to_node uuid not null references public.nodes (id) on delete cascade,
  length_m double precision,
  diameter_mm double precision,
  material text,
  laid_year integer,
  wear_percent double precision check (wear_percent >= 0 and wear_percent <= 100),
  roughness_mm double precision,
  decision text not null default 'keep' check (decision in ('keep', 'rehabilitate', 'replace')),
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists existing_pipes_project_id_idx on public.existing_pipes (project_id);
alter table public.existing_pipes enable row level security;

drop policy if exists "existing_pipes_all_own" on public.existing_pipes;
create policy "existing_pipes_all_own" on public.existing_pipes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 5. SURVEY ACTS: structured technical survey data per segment,
--    plus the scanned PDF stored in the source-files bucket.
-- ============================================================
create table if not exists public.survey_acts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  existing_pipe_id uuid references public.existing_pipes (id) on delete cascade,
  laid_year integer,
  material text,
  diameter_mm double precision,
  wear_percent double precision check (wear_percent >= 0 and wear_percent <= 100),
  defects text,
  overgrowth_percent double precision check (overgrowth_percent >= 0 and overgrowth_percent <= 100),
  scan_path text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists survey_acts_project_id_idx on public.survey_acts (project_id);
alter table public.survey_acts enable row level security;

drop policy if exists "survey_acts_all_own" on public.survey_acts;
create policy "survey_acts_all_own" on public.survey_acts
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

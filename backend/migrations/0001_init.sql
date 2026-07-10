-- AquaScheme: initial database schema
-- Apply in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Tables: profiles, projects, datasets, buildings, nodes, pipes, calc_runs, exports.
-- All tables are protected by RLS: a user can only access rows of projects they own.

-- ============================================================
-- 1. PROFILES
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row when a new user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. PROJECTS
-- ============================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id);

alter table public.projects enable row level security;

create policy "projects_all_own" on public.projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Keep updated_at fresh.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Ownership check used by RLS policies of all child tables.
-- SECURITY DEFINER avoids recursive RLS evaluation on projects.
create function public.is_project_owner(project uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.projects p
    where p.id = project and p.owner_id = (select auth.uid())
  );
$$;

-- ============================================================
-- 3. DATASETS: uploaded source data (topography, geology, ...)
-- ============================================================

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('topography', 'buildings', 'source', 'geology', 'seismic', 'normative')),
  file_name text,
  storage_path text,
  -- Parsed content (e.g. survey points as JSON array). MVP scale: a demo district.
  content jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index datasets_project_id_idx on public.datasets (project_id);

alter table public.datasets enable row level security;

create policy "datasets_all_own" on public.datasets
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 4. BUILDINGS: water consumers
-- ============================================================

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text,
  x double precision not null,
  y double precision not null,
  ground_elevation double precision,
  floors integer not null default 1 check (floors >= 1),
  residents integer check (residents >= 0),
  -- Per capita demand override, liters per person per day (default comes from SP RK 4.01-101).
  specific_demand_lpd double precision,
  created_at timestamptz not null default now()
);

create index buildings_project_id_idx on public.buildings (project_id);

alter table public.buildings enable row level security;

create policy "buildings_all_own" on public.buildings
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 5. NODES: network nodes (source, junctions, hydrants, valves, wells)
-- ============================================================

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('source', 'junction', 'hydrant', 'valve', 'air_valve', 'drain', 'well')),
  label text,
  x double precision not null,
  y double precision not null,
  ground_elevation double precision,
  demand_lps double precision,
  building_id uuid references public.buildings (id) on delete set null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index nodes_project_id_idx on public.nodes (project_id);

alter table public.nodes enable row level security;

create policy "nodes_all_own" on public.nodes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 6. PIPES: network edges
-- ============================================================

create table public.pipes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_node uuid not null references public.nodes (id) on delete cascade,
  to_node uuid not null references public.nodes (id) on delete cascade,
  length_m double precision,
  diameter_mm double precision,
  material text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index pipes_project_id_idx on public.pipes (project_id);
create index pipes_from_node_idx on public.pipes (from_node);
create index pipes_to_node_idx on public.pipes (to_node);

alter table public.pipes enable row level security;

create policy "pipes_all_own" on public.pipes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 7. CALC_RUNS: hydraulic calculation runs
-- ============================================================

create table public.calc_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  params jsonb,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index calc_runs_project_id_idx on public.calc_runs (project_id);

alter table public.calc_runs enable row level security;

create policy "calc_runs_all_own" on public.calc_runs
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 8. EXPORTS: generated deliverables (DXF, PDF, XLSX)
-- ============================================================

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  calc_run_id uuid references public.calc_runs (id) on delete set null,
  kind text not null check (kind in ('dxf_plan', 'dxf_profiles', 'pdf_note', 'spec_xlsx', 'spec_csv')),
  file_name text,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index exports_project_id_idx on public.exports (project_id);

alter table public.exports enable row level security;

create policy "exports_all_own" on public.exports
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 9. STORAGE: buckets for source files and generated exports
--    Path convention: {user_id}/{project_id}/{file_name}
-- ============================================================

insert into storage.buckets (id, name, public)
values ('source-files', 'source-files', false), ('exports', 'exports', false)
on conflict (id) do nothing;

create policy "storage_owner_all" on storage.objects
  for all
  using (
    bucket_id in ('source-files', 'exports')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('source-files', 'exports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

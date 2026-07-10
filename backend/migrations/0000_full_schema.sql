-- AquaScheme: full database schema (consolidated and idempotent).
-- Run this ONCE in Supabase SQL Editor. Safe to re-run if needed.
-- This replaces running 0001_init.sql and 0002_equipment.sql separately.

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. PROJECTS
-- ============================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_id_idx on public.projects (owner_id);
alter table public.projects enable row level security;

drop policy if exists "projects_all_own" on public.projects;
create policy "projects_all_own" on public.projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create or replace function public.is_project_owner(project uuid)
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
-- 3. DATASETS
-- ============================================================
create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null,
  file_name text,
  storage_path text,
  content jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists datasets_project_id_idx on public.datasets (project_id);
alter table public.datasets enable row level security;

drop policy if exists "datasets_all_own" on public.datasets;
create policy "datasets_all_own" on public.datasets
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 4. BUILDINGS
-- ============================================================
create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text,
  x double precision not null,
  y double precision not null,
  ground_elevation double precision,
  floors integer not null default 1 check (floors >= 1),
  residents integer check (residents >= 0),
  specific_demand_lpd double precision,
  created_at timestamptz not null default now()
);
create index if not exists buildings_project_id_idx on public.buildings (project_id);
alter table public.buildings enable row level security;

drop policy if exists "buildings_all_own" on public.buildings;
create policy "buildings_all_own" on public.buildings
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 5. NODES
-- ============================================================
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null,
  label text,
  x double precision not null,
  y double precision not null,
  ground_elevation double precision,
  demand_lps double precision,
  building_id uuid references public.buildings (id) on delete set null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nodes_project_id_idx on public.nodes (project_id);
alter table public.nodes enable row level security;

drop policy if exists "nodes_all_own" on public.nodes;
create policy "nodes_all_own" on public.nodes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 6. PIPES
-- ============================================================
create table if not exists public.pipes (
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
create index if not exists pipes_project_id_idx on public.pipes (project_id);
alter table public.pipes enable row level security;

drop policy if exists "pipes_all_own" on public.pipes;
create policy "pipes_all_own" on public.pipes
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 7. CALC_RUNS
-- ============================================================
create table if not exists public.calc_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'pending',
  params jsonb,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists calc_runs_project_id_idx on public.calc_runs (project_id);
alter table public.calc_runs enable row level security;

drop policy if exists "calc_runs_all_own" on public.calc_runs;
create policy "calc_runs_all_own" on public.calc_runs
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 8. EXPORTS
-- ============================================================
create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  calc_run_id uuid references public.calc_runs (id) on delete set null,
  kind text not null,
  file_name text,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists exports_project_id_idx on public.exports (project_id);
alter table public.exports enable row level security;

drop policy if exists "exports_all_own" on public.exports;
create policy "exports_all_own" on public.exports
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ============================================================
-- 9. DATASETS kind constraint (includes equipment)
-- ============================================================
alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in ('topography', 'buildings', 'source', 'geology', 'seismic', 'normative', 'equipment'));

-- ============================================================
-- 10. STORAGE: private buckets and owner only access
-- ============================================================
insert into storage.buckets (id, name, public)
values ('source-files', 'source-files', false), ('exports', 'exports', false)
on conflict (id) do nothing;

drop policy if exists "storage_owner_all" on storage.objects;
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

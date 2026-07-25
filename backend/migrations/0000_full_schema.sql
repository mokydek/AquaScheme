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
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit'
  ));

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

-- ============================================================
-- 11. ENGINEERING ROUTE STATE (equivalent to migration 0012)
-- ============================================================
alter table public.projects add column if not exists route_status text not null default 'stale';
alter table public.projects drop constraint if exists projects_route_status_check;
alter table public.projects add constraint projects_route_status_check
  check (route_status in ('stale', 'blocked', 'preliminary', 'calculated'));
alter table public.projects add column if not exists route_algorithm_version text;
alter table public.projects add column if not exists route_input_hash text;
alter table public.projects add column if not exists input_data_hash text;
alter table public.projects add column if not exists route_quality jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists route_warnings jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists route_blockers jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists calculation_warnings jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists calculation_blockers jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists route_report jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists route_calculated_at timestamptz;
alter table public.projects add column if not exists network_revision bigint not null default 0;

alter table public.buildings add column if not exists design_flow_lps double precision;
update public.buildings
set design_flow_lps = specific_demand_lpd,
    specific_demand_lpd = null
where design_flow_lps is null
  and specific_demand_lpd is not null
  and (upper(coalesce(label, '')) like 'ОС %' or upper(coalesce(label, '')) like 'OC %' or upper(coalesce(label, '')) like 'OS %');
alter table public.nodes add column if not exists system_type text;
alter table public.nodes add column if not exists design_flow_lps double precision;
alter table public.nodes add column if not exists invert_elevation_m double precision;
alter table public.nodes add column if not exists source_entity text;
alter table public.nodes add column if not exists data_source text;
alter table public.pipes add column if not exists engineering_kind text;
alter table public.pipes add column if not exists system_type text;
alter table public.pipes add column if not exists parallel_count integer not null default 1;
alter table public.pipes add column if not exists alignment jsonb;
alter table public.pipes add column if not exists source_layer text;
alter table public.pipes add column if not exists source_entity text;
alter table public.pipes add column if not exists flow_direction text;
alter table public.pipes add column if not exists inner_diameter_mm double precision;
alter table public.pipes add column if not exists sdr double precision;
alter table public.pipes add column if not exists sn double precision;
alter table public.pipes add column if not exists pn double precision;
alter table public.pipes add column if not exists roughness_mm double precision;
alter table public.pipes add column if not exists slope double precision;
alter table public.pipes add column if not exists start_invert_m double precision;
alter table public.pipes add column if not exists end_invert_m double precision;
alter table public.pipes add column if not exists cover_m double precision;
alter table public.pipes add column if not exists design_flow_lps double precision;
alter table public.pipes add column if not exists velocity_mps double precision;
alter table public.pipes add column if not exists filling_ratio double precision;
alter table public.pipes add column if not exists pressure_m double precision;
alter table public.pipes add column if not exists calculation_status text not null default 'unverified';
alter table public.pipes add column if not exists data_source text;

drop function if exists public.replace_project_network(uuid, jsonb, jsonb, text, text, text, jsonb, jsonb);
create or replace function public.replace_project_network(
  p_project_id uuid,
  p_nodes jsonb,
  p_pipes jsonb,
  p_route_status text,
  p_algorithm_version text,
  p_input_hash text,
  p_warnings jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb,
  p_report jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare next_revision bigint;
begin
  if not public.is_project_owner(p_project_id) then raise exception 'project access denied'; end if;
  if p_route_status not in ('blocked', 'preliminary', 'calculated') then raise exception 'invalid route status'; end if;
  create temporary table route_node_map (engine_id text primary key, db_id uuid not null, payload jsonb not null) on commit drop;
  insert into route_node_map select item ->> 'id', gen_random_uuid(), item from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) item;
  delete from public.pipes where project_id = p_project_id;
  delete from public.nodes where project_id = p_project_id;
  insert into public.nodes (id, project_id, kind, label, x, y, ground_elevation, demand_lps, design_flow_lps, invert_elevation_m, system_type, building_id, source_entity, data_source, meta)
  select m.db_id, p_project_id, coalesce(m.payload ->> 'kind', 'junction'), coalesce(m.payload ->> 'label', m.engine_id),
    (m.payload ->> 'x')::double precision, (m.payload ->> 'y')::double precision,
    nullif(m.payload ->> 'groundElevation', '')::double precision, nullif(m.payload ->> 'designFlowLps', '')::double precision,
    nullif(m.payload ->> 'designFlowLps', '')::double precision, nullif(m.payload ->> 'invertElevationM', '')::double precision,
    m.payload ->> 'systemType', nullif(m.payload ->> 'buildingId', '')::uuid, m.payload ->> 'sourceEntity', m.payload ->> 'dataSource',
    jsonb_build_object('engineKind', m.payload ->> 'kind', 'engineId', m.engine_id)
  from route_node_map m;
  insert into public.pipes (
    project_id, from_node, to_node, length_m, diameter_mm, material,
    engineering_kind, system_type, parallel_count, alignment, source_layer,
    source_entity, flow_direction, inner_diameter_mm, sdr, sn, pn,
    roughness_mm, slope, start_invert_m, end_invert_m, cover_m,
    design_flow_lps, velocity_mps, filling_ratio, pressure_m,
    calculation_status, data_source, meta
  )
  select p_project_id, f.db_id, t.db_id, nullif(item ->> 'lengthM', '')::double precision,
    nullif(item ->> 'diameterMm', '')::double precision, item ->> 'material', item ->> 'kind', item ->> 'systemType',
    greatest(1, coalesce(nullif(item ->> 'parallelCount', '')::integer, 1)), item -> 'alignment', item ->> 'sourceLayer',
    item ->> 'sourceEntity', item ->> 'flowDirection',
    nullif(item ->> 'innerDiameterMm', '')::double precision,
    nullif(item ->> 'sdr', '')::double precision,
    nullif(item ->> 'sn', '')::double precision,
    nullif(item ->> 'pn', '')::double precision,
    nullif(item ->> 'roughnessMm', '')::double precision,
    nullif(item ->> 'slope', '')::double precision,
    nullif(item ->> 'startInvertM', '')::double precision,
    nullif(item ->> 'endInvertM', '')::double precision,
    nullif(item ->> 'coverM', '')::double precision,
    nullif(item ->> 'designFlowLps', '')::double precision,
    nullif(item ->> 'velocityMs', '')::double precision,
    nullif(item ->> 'fillingRatio', '')::double precision,
    nullif(item ->> 'pressureM', '')::double precision,
    coalesce(item ->> 'calculationStatus', 'unverified'), item ->> 'dataSource',
    jsonb_build_object('kind', item ->> 'kind', 'engineId', item ->> 'id')
  from jsonb_array_elements(coalesce(p_pipes, '[]'::jsonb)) item
  join route_node_map f on f.engine_id = item ->> 'fromNode'
  join route_node_map t on t.engine_id = item ->> 'toNode';
  update public.projects set route_status = p_route_status, route_algorithm_version = p_algorithm_version,
    route_input_hash = p_input_hash, input_data_hash = p_input_hash,
    route_warnings = coalesce(p_warnings, '[]'::jsonb), route_blockers = coalesce(p_blockers, '[]'::jsonb),
    calculation_warnings = coalesce(p_warnings, '[]'::jsonb), calculation_blockers = coalesce(p_blockers, '[]'::jsonb),
    route_report = coalesce(p_report, '{}'::jsonb), route_quality = coalesce(p_report, '{}'::jsonb),
    route_calculated_at = now(), network_revision = network_revision + 1
  where id = p_project_id returning network_revision into next_revision;
  return next_revision;
end;
$$;

create or replace function public.save_gravity_design(p_project_id uuid, p_result jsonb)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare item jsonb; run_id uuid;
begin
  if not public.is_project_owner(p_project_id) then raise exception 'project access denied'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_result -> 'pipes', '[]'::jsonb)) loop
    update public.pipes set diameter_mm = nullif(item ->> 'diameterMm', '')::double precision,
      slope = nullif(item ->> 'slope', '')::double precision,
      design_flow_lps = nullif(item ->> 'flowLps', '')::double precision,
      velocity_mps = nullif(item ->> 'velocityMs', '')::double precision,
      filling_ratio = nullif(item ->> 'fillRatio', '')::double precision,
      calculation_status = case when jsonb_array_length(coalesce(item -> 'issues', '[]'::jsonb)) = 0 then 'calculated' else 'preliminary' end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'flowLps', nullif(item ->> 'flowLps', '')::double precision,
        'velocityMs', nullif(item ->> 'velocityMs', '')::double precision,
        'slope', nullif(item ->> 'slope', '')::double precision,
        'fillRatio', nullif(item ->> 'fillRatio', '')::double precision)
    where project_id = p_project_id and meta ->> 'engineId' = item ->> 'id';
  end loop;
  insert into public.calc_runs (project_id, status, params, summary, finished_at)
  values (p_project_id, 'done', jsonb_build_object('system', p_result ->> 'systemType', 'outletFlowLps', p_result -> 'outletFlowLps'), p_result, now())
  returning id into run_id;
  return run_id;
end;
$$;

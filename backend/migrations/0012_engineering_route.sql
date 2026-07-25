-- AquaScheme: explicit engineering topology and atomic route replacement.
-- Apply AFTER 0011. Idempotent.

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
-- Legacy demo rows stored facility flow (L/s) in specific_demand_lpd. Migrate
-- only unmistakably labelled treatment facilities; ordinary buildings remain
-- untouched because their daily demand cannot be inferred safely.
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

alter table public.datasets drop constraint if exists datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in (
    'topography', 'buildings', 'source', 'geology', 'seismic', 'normative',
    'equipment', 'region', 'drainage', 'basis', 'route_constraints', 'route_audit'
  ));

-- One RPC = one PostgreSQL transaction. A failed insert rolls back the delete,
-- so the UI can never be left with an empty/stale half-network.
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
declare
  next_revision bigint;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'project access denied';
  end if;
  if p_route_status not in ('blocked', 'preliminary', 'calculated') then
    raise exception 'invalid route status: %', p_route_status;
  end if;

  create temporary table route_node_map (
    engine_id text primary key,
    db_id uuid not null,
    payload jsonb not null
  ) on commit drop;

  insert into route_node_map (engine_id, db_id, payload)
  select item ->> 'id', gen_random_uuid(), item
  from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) item;

  delete from public.pipes where project_id = p_project_id;
  delete from public.nodes where project_id = p_project_id;

  insert into public.nodes (
    id, project_id, kind, label, x, y, ground_elevation, demand_lps,
    design_flow_lps, invert_elevation_m, system_type, building_id,
    source_entity, data_source, meta
  )
  select
    m.db_id,
    p_project_id,
    coalesce(m.payload ->> 'kind', 'junction'),
    coalesce(m.payload ->> 'label', m.engine_id),
    (m.payload ->> 'x')::double precision,
    (m.payload ->> 'y')::double precision,
    nullif(m.payload ->> 'groundElevation', '')::double precision,
    nullif(m.payload ->> 'designFlowLps', '')::double precision,
    nullif(m.payload ->> 'designFlowLps', '')::double precision,
    nullif(m.payload ->> 'invertElevationM', '')::double precision,
    m.payload ->> 'systemType',
    nullif(m.payload ->> 'buildingId', '')::uuid,
    m.payload ->> 'sourceEntity', m.payload ->> 'dataSource',
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
  select
    p_project_id,
    f.db_id,
    t.db_id,
    nullif(item ->> 'lengthM', '')::double precision,
    nullif(item ->> 'diameterMm', '')::double precision,
    item ->> 'material',
    item ->> 'kind',
    item ->> 'systemType',
    greatest(1, coalesce(nullif(item ->> 'parallelCount', '')::integer, 1)),
    item -> 'alignment',
    item ->> 'sourceLayer',
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
    coalesce(item ->> 'calculationStatus', 'unverified'),
    item ->> 'dataSource',
    jsonb_build_object('kind', item ->> 'kind', 'engineId', item ->> 'id')
  from jsonb_array_elements(coalesce(p_pipes, '[]'::jsonb)) item
  join route_node_map f on f.engine_id = item ->> 'fromNode'
  join route_node_map t on t.engine_id = item ->> 'toNode';

  update public.projects
  set route_status = p_route_status,
      route_algorithm_version = p_algorithm_version,
      route_input_hash = p_input_hash,
      input_data_hash = p_input_hash,
      route_warnings = coalesce(p_warnings, '[]'::jsonb),
      route_blockers = coalesce(p_blockers, '[]'::jsonb),
      calculation_warnings = coalesce(p_warnings, '[]'::jsonb),
      calculation_blockers = coalesce(p_blockers, '[]'::jsonb),
      route_report = coalesce(p_report, '{}'::jsonb),
      route_quality = coalesce(p_report, '{}'::jsonb),
      route_calculated_at = now(),
      network_revision = network_revision + 1
  where id = p_project_id
  returning network_revision into next_revision;

  return next_revision;
end;
$$;

create or replace function public.save_gravity_design(
  p_project_id uuid,
  p_result jsonb
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  run_id uuid;
begin
  if not public.is_project_owner(p_project_id) then raise exception 'project access denied'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_result -> 'pipes', '[]'::jsonb)) loop
    update public.pipes
    set diameter_mm = nullif(item ->> 'diameterMm', '')::double precision,
        slope = nullif(item ->> 'slope', '')::double precision,
        design_flow_lps = nullif(item ->> 'flowLps', '')::double precision,
        velocity_mps = nullif(item ->> 'velocityMs', '')::double precision,
        filling_ratio = nullif(item ->> 'fillRatio', '')::double precision,
        calculation_status = case when jsonb_array_length(coalesce(item -> 'issues', '[]'::jsonb)) = 0 then 'calculated' else 'preliminary' end,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'flowLps', nullif(item ->> 'flowLps', '')::double precision,
          'velocityMs', nullif(item ->> 'velocityMs', '')::double precision,
          'slope', nullif(item ->> 'slope', '')::double precision,
          'fillRatio', nullif(item ->> 'fillRatio', '')::double precision
        )
    where project_id = p_project_id and meta ->> 'engineId' = item ->> 'id';
  end loop;
  insert into public.calc_runs (project_id, status, params, summary, finished_at)
  values (
    p_project_id,
    'done',
    jsonb_build_object('system', p_result ->> 'systemType', 'outletFlowLps', p_result -> 'outletFlowLps'),
    p_result,
    now()
  ) returning id into run_id;
  return run_id;
end;
$$;

notify pgrst, 'reload schema';

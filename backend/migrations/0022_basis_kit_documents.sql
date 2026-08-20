-- AquaScheme: kit-wizard documents get first-class basis item ids.
-- Apply after 0021_technical_conditions.sql.
--
-- 0015 introduced `save_basis_file` with a white list of nine ids: the
-- statutory initial-permitting documents. The kit wizard saves six more
-- documents of the same object and used its own keys (`stankevicha_<slot>`),
-- which the white list rejects with 22023. The client then fell back to the
-- non-atomic path, and six uploads left one file in the database.
--
-- Three of those documents are NOT initial-permitting documents and never will
-- be: the technical survey act, the geology appendices and the route scheme.
-- They still belong to the project and deserve validated, atomic storage, so
-- they get named ids here instead of free-form keys. The remaining three map
-- onto existing ids (`tu`, `assignment`, `geology`, `topo`) and need nothing.
--
-- The list is mirrored in frontend/src/shared/basisFiles.ts and the two are
-- compared by basisFiles.test.ts: a new slot that is not declared here fails
-- the build instead of failing silently in a user's browser.
--
-- The signature grows a fifth argument, `p_extracted`, for the same reason the
-- ids are needed. A slot that parses its document (geology report, survey act)
-- has values to store beside the file name, and 0015 offered no place for
-- them: `merged_content := base_content || stored_content` lets the STORED
-- copy win over every top-level key the caller passes, so the first upload
-- would save an extraction and every re-upload would silently keep the old
-- one. Extraction now lives in its own `extracted` namespace, keyed by item,
-- and the requested item's entry is overwritten exactly like its file name.
-- The name says what it holds: extracted, not confirmed. Values an engineer
-- has confirmed live in their own datasets and are never written from here.
--
-- The four-argument form is dropped rather than left in place: two overloads
-- make PostgREST refuse the call with PGRST203, and a caller that omits the
-- argument still reaches the new function through its default.

drop function if exists public.save_basis_file(uuid, text, text, jsonb);

create or replace function public.save_basis_file(
  p_project_id uuid,
  p_item_id text,
  p_file_name text,
  p_base_content jsonb default '{}'::jsonb,
  p_extracted jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  base_content jsonb;
  base_files jsonb;
  base_extracted jsonb;
  stored_content jsonb;
  stored_files jsonb;
  stored_extracted jsonb;
  merged_extracted jsonb;
  merged_content jsonb;
  has_rows boolean;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;

  if p_item_id is null or not (p_item_id = any (array[
    -- Initial-permitting documents (0015).
    'assignment', 'apz', 'pdp', 'route_act', 'genplan_scheme',
    'topo', 'geology', 'vertical', 'tu',
    -- Kit-wizard documents of the object that are not part of that list.
    'survey_act', 'geology_appendices', 'route_scheme'
  ]::text[])) then
    raise exception 'invalid basis item: %', coalesce(p_item_id, '<null>')
      using errcode = '22023';
  end if;

  if nullif(btrim(p_file_name), '') is null then
    raise exception 'basis file name is required' using errcode = '22023';
  end if;

  base_content := case
    when jsonb_typeof(p_base_content) = 'object' then p_base_content
    else '{}'::jsonb
  end;
  base_files := case
    when jsonb_typeof(base_content -> 'files') = 'object' then base_content -> 'files'
    else '{}'::jsonb
  end;
  base_extracted := case
    when jsonb_typeof(base_content -> 'extracted') = 'object' then base_content -> 'extracted'
    else '{}'::jsonb
  end;

  loop
    -- SELECT ... FOR UPDATE serializes merges for an existing row. Under the
    -- legacy schema it locks every duplicate before their JSON is combined.
    perform 1
    from public.datasets
    where project_id = p_project_id
      and kind = 'basis'
    for update;
    has_rows := found;

    if has_rows then
      -- Merge top-level keys from all legacy rows. Later rows win only when
      -- the same key exists in more than one row; every distinct key remains.
      select coalesce(
        jsonb_object_agg(entry.key, entry.value order by dataset.created_at, dataset.id),
        '{}'::jsonb
      )
      into stored_content
      from public.datasets as dataset
      cross join lateral jsonb_each(
        case
          when jsonb_typeof(dataset.content) = 'object' then dataset.content
          else '{}'::jsonb
        end
      ) as entry
      where dataset.project_id = p_project_id
        and dataset.kind = 'basis';

      -- `files` needs its own deep merge; a shallow JSONB `||` would replace
      -- the whole object and recreate the lost-update bug.
      select coalesce(
        jsonb_object_agg(entry.key, entry.value order by dataset.created_at, dataset.id),
        '{}'::jsonb
      )
      into stored_files
      from public.datasets as dataset
      cross join lateral jsonb_each(
        case
          when jsonb_typeof(dataset.content -> 'files') = 'object' then dataset.content -> 'files'
          else '{}'::jsonb
        end
      ) as entry
      where dataset.project_id = p_project_id
        and dataset.kind = 'basis';

      -- `extracted` is merged the same way and for the same reason: one slot's
      -- parse must not erase another's.
      select coalesce(
        jsonb_object_agg(entry.key, entry.value order by dataset.created_at, dataset.id),
        '{}'::jsonb
      )
      into stored_extracted
      from public.datasets as dataset
      cross join lateral jsonb_each(
        case
          when jsonb_typeof(dataset.content -> 'extracted') = 'object' then dataset.content -> 'extracted'
          else '{}'::jsonb
        end
      ) as entry
      where dataset.project_id = p_project_id
        and dataset.kind = 'basis';

      -- Persisted database content wins over a possibly stale browser base.
      -- The requested item is the only key intentionally overwritten here.
      merged_content := base_content || stored_content;
      merged_content := jsonb_set(
        merged_content,
        '{files}',
        base_files || stored_files || jsonb_build_object(p_item_id, p_file_name),
        true
      );
      -- A call without an extraction leaves earlier extractions alone: saving
      -- a file name is not a statement that its values are gone.
      merged_extracted := base_extracted || stored_extracted;
      if jsonb_typeof(p_extracted) = 'object' then
        merged_extracted := merged_extracted || jsonb_build_object(p_item_id, p_extracted);
      end if;
      merged_content := jsonb_set(merged_content, '{extracted}', merged_extracted, true);

      update public.datasets
      set content = merged_content
      where project_id = p_project_id
        and kind = 'basis';

      update public.projects set route_status = 'stale' where id = p_project_id;
      return merged_content;
    end if;

    merged_content := jsonb_set(
      base_content,
      '{files}',
      base_files || jsonb_build_object(p_item_id, p_file_name),
      true
    );
    merged_extracted := base_extracted;
    if jsonb_typeof(p_extracted) = 'object' then
      merged_extracted := merged_extracted || jsonb_build_object(p_item_id, p_extracted);
    end if;
    merged_content := jsonb_set(merged_content, '{extracted}', merged_extracted, true);

    begin
      insert into public.datasets (project_id, kind, content)
      values (p_project_id, 'basis', merged_content);
      update public.projects set route_status = 'stale' where id = p_project_id;
      return merged_content;
    exception
      when unique_violation then
        -- Another transaction inserted the canonical row after our empty
        -- check. Retry; the next iteration locks and merges that winner.
        null;
    end;
  end loop;
end;
$$;

-- Documents already stored under the wizard's own keys move to the canonical
-- ones. Without this the owner's uploaded files would simply vanish from the
-- registry: the section used to display them through a lookup table that this
-- migration removes, so dropping the table without moving the data would be
-- the same silent loss from the other end.
--
-- Precedence matches what the screen showed before: a file uploaded through
-- the registry itself wins over the wizard's copy of the same item. The old
-- keys are left in place — copying is reversible, deleting is not — which also
-- makes re-running this file a no-op.
with mapping(old_key, new_key, priority) as (values
  ('stankevicha_topobaseFull', 'topo', 1),
  ('stankevicha_surveyStankevicha', 'topo', 2),
  ('stankevicha_technicalConditions', 'tu', 1),
  ('stankevicha_designBrief', 'assignment', 1),
  ('stankevicha_surveyReport', 'survey_act', 1),
  ('stankevicha_geologyReport', 'geology', 1),
  ('stankevicha_geologyAppendices', 'geology_appendices', 1),
  ('stankevicha_routeScheme', 'route_scheme', 1)
), pairs as (
  select distinct on (dataset.id, mapping.new_key)
    dataset.id,
    mapping.new_key,
    dataset.content -> 'files' ->> mapping.old_key as file_name
  from public.datasets as dataset
  cross join mapping
  where dataset.kind = 'basis'
    and jsonb_typeof(dataset.content -> 'files') = 'object'
    and dataset.content -> 'files' ? mapping.old_key
  order by dataset.id, mapping.new_key, mapping.priority
), moved as (
  select id, jsonb_object_agg(new_key, file_name) as files
  from pairs
  group by id
)
update public.datasets as dataset
set content = jsonb_set(
  dataset.content,
  '{files}',
  moved.files || (dataset.content -> 'files'),
  true
)
from moved
where dataset.id = moved.id;

-- The same move for what the wizard had parsed. It wrote into `items`, which
-- no reader can reach any more, and re-parsing is not always possible: the
-- source document lives on the engineer's disk, not in the project.
with mapping(old_key, leaf, new_key) as (values
  ('stankevicha_geologyReport', 'geologyReport', 'geology'),
  ('stankevicha_surveyReport', 'surveyAct', 'survey_act')
), pairs as (
  select
    dataset.id,
    mapping.new_key,
    dataset.content -> 'items' -> mapping.old_key -> mapping.leaf as payload
  from public.datasets as dataset
  cross join mapping
  where dataset.kind = 'basis'
    and jsonb_typeof(dataset.content -> 'items' -> mapping.old_key -> mapping.leaf) = 'object'
), moved as (
  select id, jsonb_object_agg(new_key, payload) as extracted
  from pairs
  group by id
)
update public.datasets as dataset
set content = jsonb_set(
  dataset.content,
  '{extracted}',
  moved.extracted || case
    when jsonb_typeof(dataset.content -> 'extracted') = 'object' then dataset.content -> 'extracted'
    else '{}'::jsonb
  end,
  true
)
from moved
where dataset.id = moved.id;

revoke all on function public.save_basis_file(uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.save_basis_file(uuid, text, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

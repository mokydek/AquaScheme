-- AquaScheme: the second form of the topographic survey gets its own item id,
-- and the white list moves into one function instead of the function body.
-- Apply after 0022_basis_kit_documents.sql.
--
-- 0022 gave every kit slot a canonical id, and two of them got the same one:
-- `topobaseFull` and `surveyStankevicha` both wrote `topo`, on the reasoning
-- that they are two forms of one initial-permitting document. Measured
-- consequence: eight uploaded documents leave SEVEN keys, the full topobase's
-- file name is replaced by the survey's, and the wizard still reports eight of
-- eight — because a check that asks «is this item in the database» cannot see
-- that another slot put a different file there. The same silent overwrite as
-- before, one layer up.
--
-- The registry of initial-permitting documents still holds one topographic
-- survey, and that stays `topo`: the full topobase. The partial survey is a
-- separate file of the object, so it gets a separate id, exactly like the
-- technical survey act and the route scheme.
--
-- The list itself moves into `public.basis_item_ids()`. It was copied whole
-- into every migration that touched it (0015 → 0022 → here), and a list that
-- is copied is a list that diverges. From now on adding a document is one
-- small migration replacing one function, and the client mirror in
-- frontend/src/shared/basisFiles.ts is compared against it by
-- basisFiles.test.ts and by scripts/basis-verify-live.test.mjs.

create or replace function public.basis_item_ids()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    -- Initial-permitting documents (0015).
    'assignment', 'apz', 'pdp', 'route_act', 'genplan_scheme',
    'topo', 'geology', 'vertical', 'tu',
    -- Documents of the object that are not part of that list (0022).
    'survey_act', 'geology_appendices', 'route_scheme',
    -- The partial survey: a separate file, therefore a separate id (0023).
    'topo_survey'
  ]::text[];
$$;

revoke all on function public.basis_item_ids() from public;
grant execute on function public.basis_item_ids() to authenticated;

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

  if p_item_id is null or not (p_item_id = any (public.basis_item_ids())) then
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

-- The partial survey moves off the shared key. Only rows where the two slots
-- actually collided are touched, and only when nothing is stored under the new
-- id yet, so re-running the file changes nothing the second time.
--
-- Which of the two files is under `topo` cannot be recovered after the fact:
-- the overwrite already happened and the loser's name is gone. So nothing is
-- moved here — the copy would be a guess. What this migration prevents is the
-- NEXT overwrite; what already happened is visible as one missing document,
-- and the wizard now says so when the engineer uploads both again.

revoke all on function public.save_basis_file(uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.save_basis_file(uuid, text, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

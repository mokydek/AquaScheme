-- AquaScheme: atomic merge of one initial-permitting-document file name.
-- Apply after 0014_dataset_uniqueness.sql.
--
-- A browser may upload two different basis documents concurrently. A normal
-- read/merge/write cycle can then lose one `content.files` key. This RPC locks
-- the basis row, merges the requested key inside PostgreSQL and preserves all
-- unrelated content. Legacy duplicate rows are merged and updated together.

create or replace function public.save_basis_file(
  p_project_id uuid,
  p_item_id text,
  p_file_name text,
  p_base_content jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  base_content jsonb;
  base_files jsonb;
  stored_content jsonb;
  stored_files jsonb;
  merged_content jsonb;
  has_rows boolean;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;

  if p_item_id is null or not (p_item_id = any (array[
    'assignment', 'apz', 'pdp', 'route_act', 'genplan_scheme',
    'topo', 'geology', 'vertical', 'tu'
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

      -- Persisted database content wins over a possibly stale browser base.
      -- The requested item is the only key intentionally overwritten here.
      merged_content := base_content || stored_content;
      merged_content := jsonb_set(
        merged_content,
        '{files}',
        base_files || stored_files || jsonb_build_object(p_item_id, p_file_name),
        true
      );

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

revoke all on function public.save_basis_file(uuid, text, text, jsonb) from public;
grant execute on function public.save_basis_file(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

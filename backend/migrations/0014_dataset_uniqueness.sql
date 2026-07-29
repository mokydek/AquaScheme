-- AquaScheme: one canonical dataset row per project and kind.
--
-- Older clients used SELECT followed by INSERT/UPDATE, so concurrent saves
-- could create duplicate rows. Keep the most recently created row from each
-- duplicate group, then enforce the invariant used by the frontend's
-- update-then-insert flow and its 23505 conflict retry.
-- The table lock closes the race between deduplication and constraint creation.

begin;

lock table public.datasets in share row exclusive mode;

-- A basis checklist is a map of independently uploaded documents. Legacy
-- duplicate rows can therefore contain disjoint file keys. Merge those keys
-- into the newest canonical row before the generic deduplication below. A key
-- from a newer row wins deterministically over the same key in an older row.
with basis_rows as (
  select
    dataset.id,
    dataset.project_id,
    dataset.created_at,
    dataset.content,
    row_number() over (
      partition by dataset.project_id
      order by dataset.created_at desc, dataset.id desc
    ) as row_rank
  from public.datasets as dataset
  where dataset.kind = 'basis'
),
basis_file_values as (
  select
    dataset.project_id,
    file.key,
    file.value,
    row_number() over (
      partition by dataset.project_id, file.key
      order by dataset.created_at desc, dataset.id desc
    ) as file_rank
  from public.datasets as dataset
  cross join lateral jsonb_each(
    case
      when jsonb_typeof(dataset.content -> 'files') = 'object'
        then dataset.content -> 'files'
      else '{}'::jsonb
    end
  ) as file
  where dataset.kind = 'basis'
),
merged_basis_files as (
  select
    project_id,
    jsonb_object_agg(key, value order by key) filter (where file_rank = 1) as files
  from basis_file_values
  group by project_id
)
update public.datasets as canonical
set content = (
  case
    when jsonb_typeof(canonical.content) = 'object' then canonical.content
    else '{}'::jsonb
  end
) || jsonb_build_object('files', coalesce(merged.files, '{}'::jsonb))
from basis_rows as ranked
left join merged_basis_files as merged on merged.project_id = ranked.project_id
where canonical.id = ranked.id
  and ranked.row_rank = 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, kind
      order by created_at desc, id desc
    ) as duplicate_rank
  from public.datasets
)
delete from public.datasets as dataset
using ranked
where dataset.id = ranked.id
  and ranked.duplicate_rank > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.datasets'::regclass
      and conname = 'datasets_project_kind_unique'
  ) then
    alter table public.datasets
      add constraint datasets_project_kind_unique unique (project_id, kind);
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- AquaScheme: isolate the existing network (phase 17).
-- Apply AFTER 0003_update1.sql. Idempotent: safe to re-run.
-- Existing pipes store their endpoint coordinates in meta and no longer
-- require node rows, so the existing network stays fully separate from the
-- designed network in nodes/pipes (which is rebuilt on every trace/import).

alter table public.existing_pipes alter column from_node drop not null;
alter table public.existing_pipes alter column to_node drop not null;

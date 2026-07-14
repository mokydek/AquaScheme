-- AquaScheme: free-form note on norm clauses (norms base НБ3).
-- Apply AFTER 0009. Idempotent: safe to re-run.
-- A clause may carry a note, e.g. why a foreign standard (ГОСТ Р) is used as a
-- methodological template while RK norms keep priority.

alter table public.norm_clauses add column if not exists note text;

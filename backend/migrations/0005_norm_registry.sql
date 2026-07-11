-- AquaScheme: norm registry and decision log (requirements update 2).
-- Apply AFTER 0004. Idempotent: safe to re-run.
-- Every decision the system makes must cite a normative clause. The engine
-- code is the source of truth for norm_documents/norm_clauses; the app mirrors
-- it here (upsert) so nothing drifts. decision_log stores per calc decisions.

-- ============================================================
-- 1. NORM DOCUMENTS and CLAUSES (shared reference data)
-- ============================================================
create table if not exists public.norm_documents (
  code text primary key,
  title text not null,
  edition text,
  status text not null default 'unverified' check (status in ('verified', 'unverified'))
);
alter table public.norm_documents enable row level security;

drop policy if exists "norm_documents_read" on public.norm_documents;
create policy "norm_documents_read" on public.norm_documents
  for select using (auth.uid() is not null);

drop policy if exists "norm_documents_write" on public.norm_documents;
create policy "norm_documents_write" on public.norm_documents
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create table if not exists public.norm_clauses (
  id text primary key,
  document_code text not null references public.norm_documents (code) on delete cascade,
  clause text,
  requirement text not null,
  value_text text,
  units text,
  applies_system text[],
  applies_work text[],
  status text not null default 'unverified' check (status in ('verified', 'unverified'))
);
alter table public.norm_clauses enable row level security;

drop policy if exists "norm_clauses_read" on public.norm_clauses;
create policy "norm_clauses_read" on public.norm_clauses
  for select using (auth.uid() is not null);

drop policy if exists "norm_clauses_write" on public.norm_clauses;
create policy "norm_clauses_write" on public.norm_clauses
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================
-- 2. DECISION LOG (per project / calc run)
-- ============================================================
create table if not exists public.decision_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  calc_run_id uuid references public.calc_runs (id) on delete cascade,
  key text not null,
  value_text text,
  norm_refs text[],
  inputs jsonb,
  basis text not null default 'normative' check (basis in ('normative', 'engineering', 'economic')),
  created_at timestamptz not null default now()
);
create index if not exists decision_log_project_id_idx on public.decision_log (project_id);
alter table public.decision_log enable row level security;

drop policy if exists "decision_log_all_own" on public.decision_log;
create policy "decision_log_all_own" on public.decision_log
  for all using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

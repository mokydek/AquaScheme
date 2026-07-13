-- AquaScheme: unified consumption, water → drainage link (requirements
-- update 3, change 4). Apply AFTER 0007. Idempotent: safe to re-run.
-- Specific wastewater discharge equals specific water demand without
-- irrigation (engine consumption.ts, norm drainage.equalsWater). A sewer
-- project may pull its flows from an existing water project — the single
-- source of truth — via water_source_project_id. When the water calc changes,
-- the sewer side is marked "требует пересчёта" (tracked in the drainage
-- dataset snapshot).

-- ============================================================
-- 1. Link a sewer project to its water supply project
-- ============================================================
alter table public.projects
  add column if not exists water_source_project_id uuid
    references public.projects (id) on delete set null;

-- ============================================================
-- 2. Allow the drainage dataset kind (per project drainage settings)
-- ============================================================
alter table public.datasets drop constraint datasets_kind_check;
alter table public.datasets add constraint datasets_kind_check
  check (kind in ('topography', 'buildings', 'source', 'geology', 'seismic', 'normative', 'equipment', 'region', 'drainage'));

-- AquaScheme: проверка применённой схемы.
--
-- Вставьте целиком в Supabase SQL Editor и выполните. Скрипт ничего не меняет:
-- он только сверяет то, что есть в базе, с тем, что создают миграции, и
-- показывает недостающее. Пустой результат первого запроса означает, что
-- схема полная.
--
-- Если что-то отсутствует — выполните backend/bootstrap.sql: он идемпотентен и
-- безопасно достроит недостающее, не тронув существующие данные.

-- ============================================================
-- 1. Объекты схемы: таблицы, функции, ограничения
-- ============================================================
with expected(kind, name, since) as (values
  -- таблицы
  ('таблица','profiles','0000'), ('таблица','projects','0000'),
  ('таблица','datasets','0000'), ('таблица','buildings','0000'),
  ('таблица','nodes','0000'),    ('таблица','pipes','0000'),
  ('таблица','calc_runs','0000'),('таблица','exports','0000'),
  ('таблица','catalogs','0000'), ('таблица','catalog_items','0000'),
  ('таблица','existing_pipes','0004'), ('таблица','norm_documents','0005'),
  ('таблица','norm_clauses','0005'),   ('таблица','regions','0006'),
  ('таблица','geo_boreholes','0007'),  ('таблица','geo_layers','0007'),
  ('таблица','geo_water','0007'),      ('таблица','decision_log','0003'),
  ('таблица','parcels','0003'),        ('таблица','survey_acts','0003'),
  -- функции
  ('функция','is_project_owner','0000'),
  ('функция','handle_new_user','0000'),
  ('функция','set_updated_at','0000'),
  ('функция','replace_project_network','0012'),
  ('функция','save_gravity_design','0012'),
  ('функция','save_basis_file','0015'),
  -- ограничения
  ('ограничение','datasets_kind_check','0000'),
  ('ограничение','nodes_kind_check','0012'),
  ('ограничение','projects_route_status_check','0012'),
  ('ограничение','datasets_project_kind_unique','0014')
),
actual(kind, name) as (
  select 'таблица', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'функция', p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'ограничение', con.conname::text
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
   where n.nspname = 'public'
)
select e.kind          as "Вид",
       e.name          as "Объект",
       e.since         as "Миграция",
       'ОТСУТСТВУЕТ'   as "Статус"
  from expected e
  left join actual a on a.kind = e.kind and a.name = e.name
 where a.name is null
 order by e.since, e.kind, e.name;

-- ============================================================
-- 2. RLS: должна быть включена на каждой таблице проекта
-- ============================================================
select c.relname as "Таблица без RLS"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by c.relname;

-- ============================================================
-- 3. Виды узлов: движок пишет manhole и outlet при реконструкции
-- ============================================================
select case
         when pg_get_constraintdef(oid) like '%manhole%'
          and pg_get_constraintdef(oid) like '%outlet%'
         then 'ok: manhole и outlet разрешены'
         else 'ПРОБЛЕМА: ограничение не разрешает manhole/outlet — примените 0012'
       end as "Виды узлов"
  from pg_constraint
 where conname = 'nodes_kind_check';

-- ============================================================
-- 4. Сводка
-- ============================================================
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r')                as "Таблиц",
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public')                                    as "Функций",
       (select count(*) from pg_policies where schemaname = 'public')    as "Политик RLS",
       (select count(*) from storage.buckets where id = 'source-files')  as "Бакет source-files";

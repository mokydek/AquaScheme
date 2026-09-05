#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One-file database bootstrap.
 *
 * A new installation had to run 0000_full_schema.sql and then every migration
 * from 0003 upward by hand, in order, without skipping — which is exactly the
 * kind of instruction that gets half-followed and leaves a schema the frontend
 * cannot use. This concatenates the same files, in the same order, into a
 * single script that can be pasted into the SQL editor once.
 *
 * ИЗ ИДЕМПОТЕНТНОСТИ ЧАСТЕЙ ИДЕМПОТЕНТНОСТЬ СКЛЕЙКИ НЕ СЛЕДУЕТ. Здесь раньше
 * стояло ровно это рассуждение — «каждая миграция идемпотентна, значит и
 * результат тоже», — и оно неверно. Каждая миграция снимает своё ограничение и
 * ставит заново; поодиночке это безопасно, а подряд прогоняет по базе всю
 * историю ограничения. `datasets_kind_check` переписывался двенадцать раз, и
 * первая же редакция — из двенадцати видов — падает на законных строках базы, в
 * которой уже работали:
 *
 *   ERROR: 23514: check constraint "datasets_kind_check" of relation
 *   "datasets" is violated by some row
 *
 * На пустой базе не падает ничего: строк нет, любое ограничение встаёт. Именно
 * поэтому дефект дожил до первого применения к рабочей базе владельца.
 *
 * Поэтому склейка НЕ дословная: ограничение применяется только в последней
 * своей редакции (`disableSupersededConstraints`), промежуточные остаются в
 * файле закомментированными с причиной. Применимость к базе с данными
 * проверяется в `build-bootstrap.test.mjs` — свойством самого файла, а не
 * выводом о свойствах частей.
 *
 * 0001 и 0002 пропущены: 0000 сам объявляет, что их заменяет.
 *
 *   node scripts/build-bootstrap.mjs           # write backend/bootstrap.sql
 *   node scripts/build-bootstrap.mjs --check   # fail if it is out of date
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIGRATIONS = join(ROOT, 'backend', 'migrations')
const OUTPUT = join(ROOT, 'backend', 'bootstrap.sql')

/** Superseded by 0000_full_schema.sql, which says so in its own header. */
const SUPERSEDED = new Set(['0001_init.sql', '0002_equipment.sql'])

export function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql') && /^\d{4}_/.test(name))
    .filter((name) => !SUPERSEDED.has(name))
    .sort()
}

/**
 * Statements that add or drop a named constraint, at the top level of the file.
 *
 * Lines inside a `$$ … $$` body are skipped on purpose: 0014 adds
 * `datasets_project_kind_unique` from inside a `do $$` block guarded by
 * `if not exists`, and touching a line in there would break the block instead
 * of disabling a statement.
 *
 * `values` holds the literals of a `check (… in (…))` list, or null when the
 * constraint is not a value check. That is what lets a caller prove one edition
 * of a constraint admits everything an earlier edition admitted.
 */
export function constraintStatements(sql) {
  const lines = sql.split('\n')
  const found = []
  let inDollar = false
  for (let index = 0; index < lines.length; index++) {
    const dollars = (lines[index].match(/\$\$/g) ?? []).length
    if (dollars % 2 === 1) { inDollar = !inDollar; continue }
    if (inDollar) continue
    if (!/^\s*alter\s+table\b/i.test(lines[index])) continue
    let end = index
    while (end < lines.length && !lines[end].includes(';')) end += 1
    const body = lines.slice(index, end + 1).join('\n')
    const add = /\badd\s+constraint\s+([a-zA-Z0-9_]+)/i.exec(body)
    const drop = /\bdrop\s+constraint\s+(if\s+exists\s+)?([a-zA-Z0-9_]+)/i.exec(body)
    if (add || drop) {
      const check = /\bcheck\s*\(([\s\S]*)\)\s*;/i.exec(body)
      found.push({
        kind: add ? 'add' : 'drop',
        name: add ? add[1] : drop[2],
        ifExists: Boolean(drop && drop[1]),
        firstLine: index,
        lastLine: end,
        values: add && check
          ? [...new Set([...check[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]))].sort()
          : null,
      })
    }
    index = end
  }
  return found
}

/**
 * Comment out every edition of a constraint except its last one.
 *
 * ИЗ ИДЕМПОТЕНТНОСТИ КАЖДОЙ МИГРАЦИИ ПО ОТДЕЛЬНОСТИ ИДЕМПОТЕНТНОСТЬ ИХ СКЛЕЙКИ
 * НЕ СЛЕДУЕТ. Каждая миграция снимает своё ограничение и ставит его заново, и
 * поодиночке это безопасно. Слепленные подряд, они прогоняют по базе всю
 * историю ограничения: `datasets_kind_check` переписывался двенадцать раз, и
 * первая же редакция — из двенадцати видов, без `manhole_catalog`,
 * `pump_catalog`, `title_block`, `master_plan`, `vertical_plan`,
 * `gravity_basins`, `technical_conditions` — падает на законных строках базы,
 * в которой уже работали. На пустой базе не падает ничего: строк нет.
 *
 * Правило ОБЩЕЕ, а не про `datasets_kind_check`: промежуточная редакция любого
 * ограничения в склейке бессмысленна — её результат затирает следующая, — а
 * сломать применение она может. Так же отключаются и одинаковые повторы
 * (`projects_route_status_check`, `nodes_kind_check`): работы они не делают.
 *
 * Отключённое НЕ ВЫБРАСЫВАЕТСЯ: файл читают руками, вставляя в SQL-редактор, и
 * исчезнувший без следа кусок миграции читается как потеря, а не как решение.
 * Строки остаются на месте закомментированными, с причиной над ними.
 *
 * Пара `drop`/`add` отключается ЦЕЛИКОМ: оставленный одинокий
 * `drop constraint` без `if exists` упадёт сам по себе, если предыдущего
 * `add` не было.
 */
export function disableSupersededConstraints(sql) {
  const lines = sql.split('\n')
  const statements = constraintStatements(sql)
  const lastAdd = new Map()
  for (const statement of statements) {
    if (statement.kind === 'add') lastAdd.set(statement.name, statement.firstLine)
  }
  const repeated = new Set()
  const seen = new Map()
  for (const statement of statements) {
    if (statement.kind !== 'add') continue
    seen.set(statement.name, (seen.get(statement.name) ?? 0) + 1)
    if (seen.get(statement.name) > 1) repeated.add(statement.name)
  }

  const disabled = new Set()
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (!repeated.has(statement.name)) continue
    if (statement.kind === 'add') {
      if (statement.firstLine !== lastAdd.get(statement.name)) disabled.add(index)
      continue
    }
    // A drop belongs to the add that follows it: they are one edition.
    const next = statements[index + 1]
    const paired = next && next.kind === 'add' && next.name === statement.name
    if (paired && next.firstLine !== lastAdd.get(statement.name)) disabled.add(index)
  }

  // Причина пишется ОДИН РАЗ на связку drop+add, а не над каждым оператором:
  // пара — это одна редакция ограничения, и читается она как одна.
  const order = [...disabled].sort((left, right) => left - right)
  for (let position = 0; position < order.length; position++) {
    const statement = statements[order[position]]
    for (let line = statement.firstLine; line <= statement.lastLine; line++) {
      lines[line] = `-- [bootstrap] ${lines[line]}`
    }
    const previous = position > 0 ? statements[order[position - 1]] : null
    const continues = previous !== null && previous.lastLine + 1 === statement.firstLine
    if (continues) continue
    lines[statement.firstLine] = `-- [bootstrap] ОТКЛЮЧЕНО: ${statement.name} переписывается ниже.`
      + ' На пустой базе эта редакция безвредна, на базе с данными — роняет применение,'
      + ' а её результат всё равно затирает последняя редакция.'
      + `\n${lines[statement.firstLine]}`
  }
  return lines.join('\n')
}

export function buildBootstrap() {
  const files = migrationFiles()
  const parts = [
    '-- AquaScheme: complete database bootstrap.',
    '-- GENERATED by scripts/build-bootstrap.mjs — do not edit by hand.',
    '-- Run once in the Supabase SQL editor.',
    '--',
    '-- Re-running is safe, and so is running this on a database that already',
    '-- holds data — that is a property of THIS FILE, checked by',
    '-- scripts/build-bootstrap.test.mjs, not a conclusion drawn from the parts.',
    '-- Every constraint is applied in its last edition only; the superseded',
    '-- editions are left in place commented out, each with its reason. Applying',
    '-- them in sequence would replay the whole history of a constraint against',
    '-- live rows, and the narrow early editions fail on lawful data.',
    `-- Sources, in order: ${files.join(', ')}`,
    '',
  ]
  for (const name of files) {
    parts.push(
      '-- ============================================================',
      `-- BEGIN ${name}`,
      '-- ============================================================',
      withoutCrlf(readFileSync(join(MIGRATIONS, name), 'utf8')).trimEnd(),
      `-- END ${name}`,
      '',
    )
  }
  const sql = disableSupersededConstraints(parts.join('\n'))

  // Оставшийся `drop constraint` без `if exists` упадёт сам по себе, если
  // предыдущего `add` в базе не было. Это дефект СБОРКИ, и ловить его надо
  // здесь, а не в SQL-редакторе у пользователя.
  const naked = constraintStatements(sql)
    .filter((statement) => statement.kind === 'drop' && !statement.ifExists)
  if (naked.length > 0) {
    throw new Error(
      'drop constraint без if exists остался в склейке: '
        + naked.map((statement) => `${statement.name} (строка ${statement.firstLine + 1})`).join(', ')
        + '. Добавьте if exists в саму миграцию: одна она упадёт так же.',
    )
  }
  return sql
}

/**
 * Текст без CRLF.
 *
 * Git отдаёт файлы на Windows с CRLF, а склейка собирается в памяти с LF, и
 * побайтовое сравнение краснело на свежей выкладке при полностью совпадающем
 * содержимом: «bootstrap.sql устарел» на нетронутом файле. Перевод строки
 * ничего не значит ни для SQL, ни для порядка миграций, и различать выкладки
 * по нему проверка не должна.
 */
export function withoutCrlf(text) {
  return text.replace(/\r\n/g, '\n')
}

if (process.argv[1] && process.argv[1].endsWith('build-bootstrap.mjs')) {
  const generated = buildBootstrap()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error('backend/bootstrap.sql отсутствует. Выполните: node scripts/build-bootstrap.mjs')
      process.exit(1)
    }
    if (withoutCrlf(current) !== generated) {
      console.error('backend/bootstrap.sql устарел относительно backend/migrations/.')
      console.error('Выполните: node scripts/build-bootstrap.mjs')
      process.exit(1)
    }
    console.log(`bootstrap.sql актуален (${migrationFiles().length} миграций).`)
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`backend/bootstrap.sql собран из ${migrationFiles().length} миграций.`)
  }
}

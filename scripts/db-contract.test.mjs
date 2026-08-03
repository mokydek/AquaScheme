import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Договор между кодом и базой.
 *
 * Значения перечислений живут в двух местах: типом в TypeScript и ограничением
 * CHECK в Postgres. Компилятор о втором не знает, а тесты в базу не ходят —
 * поэтому новый вид узла проходит сборку, проходит все проверки и падает только
 * при сохранении у пользователя, ошибкой ограничения без внятного объяснения.
 *
 * Здесь эти два списка сверяются. Требование одностороннее: база должна
 * принимать всё, что пишет код. Обратное лишним не считается — в базе остаются
 * виды прежних установок, которые движок уже не создаёт.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const bootstrap = readFileSync(new URL('../backend/bootstrap.sql', import.meta.url), 'utf8')

/** Литералы из списка `in ('a', 'b')`. */
const literals = (list) => [...list.matchAll(/'([^']*)'/g)].map((match) => match[1])

/**
 * Действующее ограничение: миграции переопределяют его по мере роста схемы,
 * поэтому берётся последнее вхождение, а не первое.
 */
function effectiveCheck(constraint, column) {
  const pattern = new RegExp(
    `add constraint ${constraint}\\s*check \\(${column} in \\(([^)]*)\\)\\)`,
    'g',
  )
  const found = [...bootstrap.matchAll(pattern)]
  assert.ok(found.length > 0, `в bootstrap.sql не найдено ограничение ${constraint}`)
  return literals(found[found.length - 1][1])
}

/**
 * Значения строкового объединения TypeScript.
 *
 * Разбор построчный, а не по пустой строке: рабочая копия на Windows хранится
 * с CRLF, и поиск `\n\n` не находил конца объявления — в список попадал весь
 * остаток файла вместе с соседними типами.
 */
function unionMembers(file, name) {
  const lines = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`export type ${name} =`))
  assert.ok(start >= 0, `в ${file} не найден тип ${name}`)
  const body = [lines[start]]
  for (let index = start + 1; index < lines.length; index++) {
    if (!/^\s*\|/.test(lines[index])) break
    body.push(lines[index])
  }
  return literals(body.join('\n'))
}

function assertAccepted(values, accepted, what) {
  const missing = values.filter((value) => !accepted.includes(value))
  assert.deepEqual(
    missing, [],
    `${what}: база не примет ${missing.join(', ')}.`
      + ' Добавьте вид в миграцию и пересоберите bootstrap (npm run db:bootstrap),'
      + ' иначе сохранение упадёт ошибкой ограничения уже у пользователя.',
  )
}

test('база принимает все виды узлов, которые строит движок', () => {
  const engine = unionMembers('../engine/src/trace.ts', 'NetworkNodeKind')
  assert.ok(engine.length >= 15, `видов узлов подозрительно мало: ${engine.length}`)
  assertAccepted(engine, effectiveCheck('nodes_kind_check', 'kind'), 'nodes.kind')
})

test('база принимает все виды наборов данных, которые пишет интерфейс', () => {
  const frontend = unionMembers('../frontend/src/shared/datasets.ts', 'DatasetKind')
  assert.ok(frontend.length >= 10, `видов наборов подозрительно мало: ${frontend.length}`)
  assertAccepted(frontend, effectiveCheck('datasets_kind_check', 'kind'), 'datasets.kind')
})

test('база принимает все состояния трассы, которые записывает интерфейс', () => {
  const accepted = effectiveCheck('projects_route_status_check', 'route_status')
  const sources = ['../frontend/src/shared/network.ts', '../frontend/src/shared/datasets.ts']
  const written = new Set()
  for (const file of sources) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const match of source.matchAll(/route_status:\s*'([a-z_]+)'/g)) written.add(match[1])
  }
  assert.ok(written.size > 0, 'не найдено ни одной записи route_status — проверка потеряла смысл')
  assertAccepted([...written], accepted, 'projects.route_status')
})

test('RPC сохранения сети принимает все состояния трассы движка', () => {
  // Функция проверяет состояние строже таблицы: 'stale' она не принимает, его
  // ставят другие пути. Поэтому одного ограничения таблицы мало — расхождение
  // здесь дало бы «invalid route status» на самом сохранении.
  const match = bootstrap.match(/p_route_status not in \(([^)]*)\)/)
  assert.ok(match, 'в bootstrap.sql не найдена проверка состояния в replace_project_network')
  const engine = unionMembers('../engine/src/engineering-network.ts', 'EngineeringRouteStatus')
  assertAccepted(engine, literals(match[1]), 'replace_project_network(p_route_status)')
})

test('вид, которого нет в ограничении, проверка ловит', () => {
  // Сама проверка тоже должна падать, иначе она бесполезна: договор, который
  // ничего не запрещает, отличить от отсутствующего нельзя.
  assert.throws(
    () => assertAccepted(['junction', 'сочинённый_вид'], ['junction'], 'nodes.kind'),
    /сочинённый_вид/,
  )
})

test('bootstrap.sql прочитан из репозитория, а не подставлен пустым', () => {
  assert.ok(bootstrap.length > 10_000, `bootstrap.sql подозрительно короткий: ${bootstrap.length} байт`)
  assert.ok(ROOT.length > 0)
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildBootstrap, constraintStatements, migrationFiles } from './build-bootstrap.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('bootstrap.sql matches backend/migrations', () => {
  const current = readFileSync(join(ROOT, 'backend', 'bootstrap.sql'), 'utf8')
  assert.equal(
    current,
    buildBootstrap(),
    'backend/bootstrap.sql устарел. Выполните: node scripts/build-bootstrap.mjs',
  )
})

test('migrations are concatenated in numeric order with none skipped', () => {
  const files = migrationFiles()
  const numbers = files.map((name) => Number(name.slice(0, 4)))
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'порядок миграций нарушен')

  // 0001 and 0002 are the only permitted gap: 0000 states it replaces them.
  const missing = []
  for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) {
    if (!numbers.includes(n)) missing.push(n)
  }
  assert.deepEqual(missing, [1, 2], `в bootstrap пропущены миграции: ${missing.join(', ')}`)
})

test('every migration reaches the bootstrap; отличия — только отключённые строки', () => {
  const bootstrap = buildBootstrap()
  for (const name of migrationFiles()) {
    const body = readFileSync(join(ROOT, 'backend', 'migrations', name), 'utf8').trimEnd()
    assert.ok(bootstrap.includes(`-- BEGIN ${name}`), `${name} без маркера начала`)
    assert.ok(bootstrap.includes(`-- END ${name}`), `${name} без маркера конца`)
    // Тело миграции доходит целиком ЛИБО дословно, либо с закомментированными
    // строками. Ничего не пропадает: снятая строка остаётся на месте с
    // пометкой, потому что файл читают руками, вставляя в SQL-редактор.
    if (bootstrap.includes(body)) continue
    const section = bootstrap.slice(
      bootstrap.indexOf(`-- BEGIN ${name}`),
      bootstrap.indexOf(`-- END ${name}`),
    )
    for (const line of body.split('\n')) {
      const present = section.includes(`\n${line}\n`) || section.includes(`\n-- [bootstrap] ${line}\n`)
      assert.ok(present, `${name}: строка потеряна при сборке: ${line}`)
    }
  }
})

/**
 * ПРИМЕНИМОСТЬ К БАЗЕ С ДАННЫМИ — не то же самое, что совпадение с миграциями.
 *
 * Три проверки выше сверяют, что склейка собрана из актуальных файлов и в
 * правильном порядке. Что её можно ВЫПОЛНИТЬ на базе, в которой уже работали,
 * они не проверяют и проверить не могут — а именно на этом владелец и
 * напоролся: `ERROR: 23514: check constraint "datasets_kind_check" of relation
 * "datasets" is violated by some row`. Живой базы в CI нет и заводить её ради
 * этого не надо: дефект ловится статически.
 */
test('ни одно ограничение не добавляется в склейке дважды', () => {
  const adds = constraintStatements(buildBootstrap()).filter((statement) => statement.kind === 'add')
  const counts = new Map()
  for (const add of adds) counts.set(add.name, (counts.get(add.name) ?? 0) + 1)
  const repeated = [...counts].filter(([, count]) => count > 1)
  assert.deepEqual(
    repeated, [],
    'ограничение ставится несколько раз подряд; промежуточная редакция уронит базу с данными: '
      + repeated.map(([name, count]) => `${name} ×${count}`).join(', '),
  )
})

test('оставленная редакция ограничения не уже отброшенных', () => {
  // Если это когда-нибудь окажется не так, значит вид действительно удалили из
  // продукта — и тогда нужен явный delete/update в миграции, а не тихое
  // сужение, от которого падает применение.
  const editions = new Map()
  for (const name of migrationFiles()) {
    const body = readFileSync(join(ROOT, 'backend', 'migrations', name), 'utf8')
    for (const statement of constraintStatements(body)) {
      if (statement.kind !== 'add' || statement.values === null) continue
      const list = editions.get(statement.name) ?? []
      list.push({ file: name, values: statement.values })
      editions.set(statement.name, list)
    }
  }
  for (const [name, list] of editions) {
    if (list.length < 2) continue
    const kept = new Set(list[list.length - 1].values)
    for (const edition of list.slice(0, -1)) {
      const lost = edition.values.filter((value) => !kept.has(value))
      assert.deepEqual(
        lost, [],
        `${name}: редакция из ${edition.file} допускает значения, которых нет в оставленной: ${lost.join(', ')}`,
      )
    }
  }
})

test('повторный прогон на базе, где ограничение уже стоит, безопасен', () => {
  // Сценарий владельца: он уже развернул схему файлом, в котором промежуточные
  // редакции были закомментированы руками, и финальное ограничение из 19 видов
  // у него стоит. Второй прогон не должен упасть с 42710 «constraint already
  // exists» — значит, каждому оставленному `add` обязан предшествовать
  // `drop … if exists` того же имени.
  const statements = constraintStatements(buildBootstrap())
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.kind !== 'add') continue
    const previous = statements[index - 1]
    assert.ok(
      previous && previous.kind === 'drop' && previous.name === statement.name && previous.ifExists,
      `${statement.name} (строка ${statement.firstLine + 1}): перед add нет drop … if exists,`
        + ' повторный прогон упадёт на уже поставленном ограничении',
    )
  }
})

test('каждый drop constraint в склейке — с if exists', () => {
  const naked = constraintStatements(buildBootstrap())
    .filter((statement) => statement.kind === 'drop' && !statement.ifExists)
    .map((statement) => `${statement.name} (строка ${statement.firstLine + 1})`)
  assert.deepEqual(
    naked, [],
    'drop constraint без if exists упадёт сам по себе, если предыдущего add не было: ' + naked.join(', '),
  )
})

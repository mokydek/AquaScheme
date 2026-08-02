import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildBootstrap, migrationFiles } from './build-bootstrap.mjs'

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

test('every migration reaches the bootstrap in full', () => {
  const bootstrap = buildBootstrap()
  for (const name of migrationFiles()) {
    const body = readFileSync(join(ROOT, 'backend', 'migrations', name), 'utf8').trimEnd()
    assert.ok(bootstrap.includes(body), `${name} не вошла в bootstrap целиком`)
    assert.ok(bootstrap.includes(`-- BEGIN ${name}`), `${name} без маркера начала`)
    assert.ok(bootstrap.includes(`-- END ${name}`), `${name} без маркера конца`)
  }
})

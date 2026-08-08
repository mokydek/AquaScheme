/**
 * Живая проверка применённой схемы Supabase.
 *
 * `backend/verify.sql` рассчитан на SQL Editor: его вставляют руками и глазами
 * смотрят результат. Поэтому расхождение схемы обнаруживалось, только когда
 * кто-то вспоминал проверить — а обнаруживалось оно обычно уже поломанным
 * фронтендом, потому что миграцию применить забыли.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Он спрашивает у базы список объектов и сверяет с
 * тем, что перечислено в миграциях, печатая недостающее. Достраивать схему —
 * дело bootstrap.sql, и делает это владелец руками.
 *
 * Без переменных окружения — явный пропуск с указанием, чего не хватает, а не
 * тихий успех: зелёный вывод, в котором ничего не проверялось, хуже красного.
 *
 *   SUPABASE_URL=https://<проект>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<ключ> \
 *   npm run db:verify:live
 *
 * Нужен именно service_role: anon-ключ до системных таблиц не допускается
 * политиками, и проверка вернула бы «ничего нет» на исправной базе.
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const key = (
  process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.SUPABASE_SERVICE_KEY
  ?? ''
).trim()

if (url === '' || key === '') {
  const missing = [
    url === '' ? 'SUPABASE_URL' : null,
    key === '' ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
  ].filter(Boolean).join(', ')
  console.log(`ПРОПУЩЕНО: не задано ${missing}. Схема не проверялась.`)
  console.log('Проверка требует доступа к базе и ничего в ней не меняет.')
  process.exit(0)
}

/**
 * Ожидаемые объекты берутся из самих миграций, а не из отдельного списка:
 * второй список неминуемо разошёлся бы с первым, и проверка стала бы врать.
 */
function expectedFromMigrations() {
  const dir = join(ROOT, 'backend', 'migrations')
  const tables = new Set()
  const functions = new Set()
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8')
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)) {
      tables.add(match[1])
    }
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)) {
      functions.add(match[1])
    }
  }
  return { tables: [...tables].sort(), functions: [...functions].sort() }
}

/** Спрашивает у базы один SQL через PostgREST-функцию, если она объявлена. */
async function ask(path) {
  const response = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  return { ok: response.ok, status: response.status, body: await response.text() }
}

const expected = expectedFromMigrations()
console.log(`Миграций разобрано: таблиц ${expected.tables.length}, функций ${expected.functions.length}.`)

const missingTables = []
const unreadable = []
for (const table of expected.tables) {
  // HEAD-запрос к таблице: PostgREST отдаёт 200 на существующую и 404 на
  // отсутствующую. Ни одной строки при этом не читается и не меняется.
  const result = await ask(`/rest/v1/${table}?select=*&limit=0`)
  if (result.status === 404) missingTables.push(table)
  else if (!result.ok) unreadable.push(`${table} → ${result.status} ${result.body.slice(0, 120)}`)
}

console.log('')
if (missingTables.length === 0) {
  console.log(`Таблицы: все ${expected.tables.length} на месте.`)
} else {
  console.log(`ОТСУТСТВУЮТ ТАБЛИЦЫ (${missingTables.length}): ${missingTables.join(', ')}`)
  console.log('Примените backend/bootstrap.sql — он идемпотентен и данные не трогает.')
}

if (unreadable.length > 0) {
  console.log('')
  console.log('Не удалось проверить (это не то же самое, что «отсутствует»):')
  for (const line of unreadable) console.log(`  ${line}`)
}

console.log('')
console.log('Функции по HTTP не перечисляются: PostgREST показывает только те,')
console.log('что объявлены как RPC. Их наличие проверяется backend/verify.sql')
console.log(`в SQL Editor — ожидаются ${expected.functions.length}: ${expected.functions.join(', ')}.`)

// Ненулевой код только когда чего-то ДЕЙСТВИТЕЛЬНО нет: недоступность объекта
// по правам — не повод объявлять схему сломанной.
process.exit(missingTables.length > 0 ? 1 : 0)

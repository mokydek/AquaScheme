/**
 * Что на самом деле лежит в наборе basis у проекта.
 *
 * ПОВОД. Мастер комплекта отчитался «Готово 6 из 8; с ошибкой 0», а в наборе
 * `basis` проекта был один ключ: пять документов пропали молча. Обнаружилось
 * это только потому, что владелец пошёл в базу руками и составил запрос. Такая
 * проверка не должна требовать составления запроса — иначе её делают раз в
 * месяц, а расходятся экран и база каждый день.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Он читает набор и печатает, какие документы в нём
 * есть, сверяя ключи с белым списком базы и с составом мастера комплекта.
 *
 *   SUPABASE_URL=https://<проект>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<ключ> \
 *   node scripts/basis-verify-live.mjs <project-uuid>
 *
 * Нужен service_role: под anon-ключом строки чужого проекта закрыты политикой,
 * и проверка вернула бы «пусто» на исправной базе — худший вид неправды.
 *
 * Без переменных окружения — явный пропуск, а не тихий успех.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Белый список идентификаторов — из миграций, а не из копии здесь.
 *
 * Берётся последняя миграция, объявляющая список (сейчас это `basis_item_ids()`
 * из 0023): копия в скрипте разошлась бы с базой ровно так же, как разошлись
 * ключи мастера.
 */
export function whitelistFromMigrations(root = ROOT) {
  const dir = join(root, 'backend', 'migrations')
  let latest = []
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8')
    const declaration = /array\[([\s\S]*?)\]::text\[\]/.exec(sql)
    if (!declaration) continue
    latest = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  }
  return latest
}

/** Состав мастера комплекта — из реестра слотов, тем же способом. */
export function kitSlotsFromSource(root = ROOT) {
  const source = readFileSync(join(root, 'frontend', 'src', 'shared', 'kitWizard.ts'), 'utf8')
  const list = /export const STANKEVICHA_KIT_SLOTS[\s\S]*?\n\]/.exec(source)
  if (!list) return []
  return [...list[0].matchAll(/\{ id: '(\w+)'[^}]*basisItemId: '([a-z_]+)'/g)]
    .map((match) => ({ slotId: match[1], itemId: match[2] }))
}

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? '').trim()
const projectId = (process.argv[2] ?? '').trim()

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || process.argv[1]?.endsWith('basis-verify-live.mjs')) {
  const missing = [
    url === '' ? 'SUPABASE_URL' : null,
    key === '' ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    projectId === '' ? 'идентификатор проекта первым аргументом' : null,
  ].filter(Boolean)

  if (missing.length > 0) {
    console.log(`ПРОПУЩЕНО: не задано ${missing.join(', ')}. Набор basis не читался.`)
    console.log('Проверка требует доступа к базе и ничего в ней не меняет.')
    process.exit(0)
  }

  const response = await fetch(
    `${url}/rest/v1/datasets?project_id=eq.${encodeURIComponent(projectId)}&kind=eq.basis&select=id,created_at,content`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } },
  )
  if (!response.ok) {
    console.error(`ОШИБКА ${response.status}: ${await response.text()}`)
    process.exit(1)
  }
  const rows = await response.json()
  console.log(`строк набора basis: ${rows.length}`)
  if (rows.length > 1) {
    // Миграция 0014 оставляет одну строку на вид. Несколько — установка её не
    // получила, и запись сливает их вручную; знать об этом надо.
    console.log('НЕСКОЛЬКО СТРОК ОДНОГО ВИДА: миграция 0014 не применена, чтение объединяет их.')
  }

  const files = {}
  const extracted = {}
  for (const row of rows) {
    const content = row.content && typeof row.content === 'object' ? row.content : {}
    Object.assign(files, content.files ?? {})
    Object.assign(extracted, content.extracted ?? {})
  }

  const whitelist = whitelistFromMigrations()
  const slots = kitSlotsFromSource()

  console.log(`\nдокументов в наборе: ${Object.keys(files).length}`)
  for (const [itemId, fileName] of Object.entries(files).sort()) {
    const known = whitelist.includes(itemId) ? '' : '  ← КЛЮЧА НЕТ В БЕЛОМ СПИСКЕ БАЗЫ'
    const parsed = extracted[itemId] ? `; разбор: ${Object.keys(extracted[itemId]).join(', ')}` : ''
    console.log(`  ${itemId}: ${fileName}${parsed}${known}`)
  }

  console.log('\nслоты мастера комплекта:')
  for (const slot of slots) {
    const fileName = files[slot.itemId]
    console.log(`  ${slot.slotId} → ${slot.itemId}: ${fileName ?? 'В БАЗЕ НЕТ'}`)
  }

  const lost = slots.filter((slot) => !files[slot.itemId])
  console.log(`\nслотов без документа в базе: ${lost.length} из ${slots.length}`)
  // Код выхода ненулевой только при расхождении, которого быть не должно:
  // ключ, которого база не знает. Пустые слоты — это норма незаконченного
  // комплекта, а не отказ.
  const unknown = Object.keys(files).filter((itemId) => !whitelist.includes(itemId))
  if (unknown.length > 0) {
    console.error(`\nЧУЖИЕ КЛЮЧИ В НАБОРЕ: ${unknown.join(', ')}`)
    process.exit(1)
  }
}

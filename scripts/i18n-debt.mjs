#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Текст интерфейса мимо словарей.
 *
 * Приложение заявляет три языка. Строка, зашитая в компонент по-русски,
 * казахскому и английскому пользователю показывается по-русски — то есть два
 * языка из трёх местами неверны, и на экране это выглядит не как недоделка, а
 * как ошибка перевода.
 *
 * Показатель устроен как храповик достижимости: число может только снижаться.
 * Разом вынести весь текст нельзя — его сотни строк, — но новый зашитый текст
 * не должен добавляться незаметно.
 *
 * Считается видимый текст: содержимое JSX между тегами и значения атрибутов,
 * которые пользователь читает. Кириллица в коде и комментариях не в счёт —
 * комментарии в проекте намеренно русские.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = join(ROOT, 'docs', 'i18n-debt-baseline.json')
const CYRILLIC = /[А-Яа-яЁё]/

/** Атрибуты, значение которых пользователь читает. */
const VISIBLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt']

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Убирает комментарии и содержимое строковых литералов вне JSX, чтобы русские
 * пояснения в коде не считались текстом интерфейса.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const files = walk(join(ROOT, 'frontend', 'src'))
const byFile = []
let total = 0

for (const path of files) {
  const source = withoutComments(readFileSync(path, 'utf8'))
  const hits = []

  // Текст между тегами: >…< без фигурных скобок, то есть литеральный.
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].trim()
    if (text.length > 1 && CYRILLIC.test(text)) hits.push(text)
  }
  // Видимые атрибуты со строковым литералом.
  for (const attribute of VISIBLE_ATTRIBUTES) {
    for (const match of source.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))) {
      if (CYRILLIC.test(match[1])) hits.push(`${attribute}="${match[1]}"`)
    }
  }

  if (hits.length > 0) {
    byFile.push({ file: relative(ROOT, path).replaceAll('\\', '/'), count: hits.length })
    total += hits.length
  }
}

byFile.sort((left, right) => right.count - left.count || left.file.localeCompare(right.file))

const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
const baseline = previous?.total ?? Number.POSITIVE_INFINITY

for (const item of byFile.slice(0, 20)) console.log(`${String(item.count).padStart(4)}  ${item.file}`)
if (byFile.length > 20) console.log(`      … и ещё ${byFile.length - 20} файлов`)
console.log(`\nстрок интерфейса мимо словарей: ${total} в ${byFile.length} файлах`
  + (previous ? ` (уровень ${baseline})` : ''))

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    _comment: 'Текст интерфейса мимо словарей. Может только снижаться; обновляется через'
      + ' npm run audit:i18n -- --write-baseline. Приложение заявляет три языка, и зашитая'
      + ' по-русски строка двум из них показывается неверно.',
    total,
    files: byFile,
  }, null, 2)}\n`, 'utf8')
  console.log(`уровень записан: ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (total > baseline) {
  const known = new Map((previous?.files ?? []).map((item) => [item.file, item.count]))
  const grown = byFile.filter((item) => item.count > (known.get(item.file) ?? 0))
  console.error(`\nОшибка: текста мимо словарей стало больше (${total} против ${baseline}).`)
  if (grown.length > 0) {
    console.error(`Выросли: ${grown.map((item) => `${item.file} ${known.get(item.file) ?? 0}→${item.count}`).join(', ')}.`)
  }
  console.error('Строка, зашитая по-русски, казахскому и английскому пользователю показывается по-русски.')
  process.exit(1)
}
if (total < baseline && previous) {
  console.log(`уровень снижен на ${baseline - total}; запишите его: npm run audit:i18n -- --write-baseline`)
}
process.exit(0)

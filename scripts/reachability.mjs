#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Возможности движка, до которых нельзя дотянуться.
 *
 * Движок развивается быстрее интерфейса и проверяется своими тестами: они
 * зелёные, а воспользоваться возможностью нельзя — вызывать её неоткуда. За
 * одну сессию так нашлось шесть таких мест поштучно, а сплошной обход показал
 * десятки: подбор насосов, замок нормативных редакций, аудит происхождения
 * значений, вертикальная планировка — всё с тестами и без единого места
 * применения.
 *
 * Скрипт считает экспортируемые функции движка, на которые нет ни одной ссылки
 * извне их собственного модуля, и сравнивает с записанным уровнем. Уровень
 * может только снижаться: рост — ошибка сборки. Это храповик, а не запрет —
 * новая функция допустима, если к ней сразу есть путь.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = join(ROOT, 'docs', 'reachability-baseline.json')

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

const engineFiles = walk(join(ROOT, 'engine', 'src'))
  .filter((path) => !path.endsWith(`${join('engine', 'src', 'index.ts')}`))
const frontendFiles = existsSync(join(ROOT, 'frontend', 'src'))
  ? walk(join(ROOT, 'frontend', 'src'))
  : []

/** Где объявлена каждая экспортируемая функция. */
const declaredIn = new Map()
for (const path of engineFiles) {
  const source = readFileSync(path, 'utf8')
  for (const match of source.matchAll(/^export function ([A-Za-z0-9_]+)/gm)) {
    if (!declaredIn.has(match[1])) declaredIn.set(match[1], path)
  }
}

// Содержимое читается один раз: файлов сотни, а имён — двести.
const contents = new Map([...engineFiles, ...frontendFiles].map((path) => [path, readFileSync(path, 'utf8')]))

const orphans = []
for (const [name, home] of declaredIn) {
  const pattern = new RegExp(`\\b${name}\\b`)
  let referenced = false
  for (const [path, source] of contents) {
    // Свой модуль не считается: внутренний вызов путём к возможности не делает.
    if (path === home) continue
    // Реэкспорт тоже не считается: он лишь переносит имя наружу.
    if (/^export \* from/m.test(source) && !pattern.test(source.replace(/^export \* from.*$/gm, ''))) continue
    if (pattern.test(source)) { referenced = true; break }
  }
  if (!referenced) orphans.push({ name, file: relative(ROOT, home).replaceAll('\\', '/') })
}
orphans.sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name))

const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
const baselineCount = previous?.count ?? Number.POSITIVE_INFINITY

for (const orphan of orphans) console.log(`${orphan.file}: ${orphan.name}`)
console.log(`\nвозможностей без пути с экрана: ${orphans.length}` + (previous ? ` (уровень ${baselineCount})` : ''))

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    _comment: 'Уровень недостижимых возможностей движка. Может только снижаться; обновляется через npm run audit:reachability -- --write-baseline.',
    count: orphans.length,
    functions: orphans,
  }, null, 2)}\n`, 'utf8')
  console.log(`уровень записан: ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (orphans.length > baselineCount) {
  const known = new Set((previous?.functions ?? []).map((item) => item.name))
  const added = orphans.filter((orphan) => !known.has(orphan.name))
  console.error(`\nОшибка: недостижимых возможностей стало больше (${orphans.length} против ${baselineCount}).`)
  if (added.length > 0) console.error(`Новые: ${added.map((item) => item.name).join(', ')}.`)
  console.error('Возможность не считается сделанной, пока к ней нет пути с экрана.')
  process.exit(1)
}
if (orphans.length < baselineCount && previous) {
  console.log(`уровень снижен на ${baselineCount - orphans.length}; запишите его: npm run audit:reachability -- --write-baseline`)
}
process.exit(0)

#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Возможности движка, до которых нельзя дотянуться.
 *
 * Показатель делится надвое, иначе он вводит в заблуждение. Часть функций
 * экспортируется намеренно: нормативная формула проверяется тестом против
 * своего пункта, и снять с неё экспорт значило бы удалить проверку. Такие
 * перечислены в `internal` и в долг не идут. Храповик держит второе число —
 * возможности, к которым инженер обязан иметь путь.
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

/**
 * Тело каждой функции движка, чтобы построить граф вызовов.
 *
 * Простое «есть ли имя в другом файле» давало ложные срабатывания: функция,
 * которую вызывает соседняя в том же модуле, считалась сиротой. Так три
 * ограничения заглубления канализации попали в долг, хотя их применяет
 * `minSewerInvertDepthM`, а его — расчёт профиля. Поэтому достижимость
 * считается транзитивно: от того, что вызывает интерфейс, вниз по вызовам.
 */
const bodies = new Map()
for (const path of engineFiles) {
  const source = contents.get(path)
  const marks = [...source.matchAll(/^(?:export )?function ([A-Za-z0-9_]+)/gm)]
  for (let index = 0; index < marks.length; index++) {
    const start = marks[index].index
    const end = index + 1 < marks.length ? marks[index + 1].index : source.length
    bodies.set(marks[index][1], source.slice(start, end))
  }
}

/** Имена, на которые ссылается интерфейс: с них начинается достижимость. */
const reachable = new Set()
for (const path of frontendFiles) {
  const source = contents.get(path)
  for (const name of declaredIn.keys()) {
    if (new RegExp(`\\b${name}\\b`).test(source)) reachable.add(name)
  }
}
// Ссылка из другого модуля движка тоже начинает цепочку.
for (const [name, home] of declaredIn) {
  if (reachable.has(name)) continue
  for (const path of engineFiles) {
    if (path === home) continue
    if (new RegExp(`\\b${name}\\b`).test(contents.get(path))) { reachable.add(name); break }
  }
}
// Спуск по вызовам: то, что вызывает достижимое, достижимо и само.
for (let changed = true; changed;) {
  changed = false
  for (const name of [...reachable]) {
    const body = bodies.get(name)
    if (!body) continue
    for (const candidate of declaredIn.keys()) {
      if (reachable.has(candidate) || candidate === name) continue
      if (new RegExp(`\\b${candidate}\\b`).test(body)) { reachable.add(candidate); changed = true }
    }
  }
}

const orphans = [...declaredIn]
  .filter(([name]) => !reachable.has(name))
  .map(([name, home]) => ({ name, file: relative(ROOT, home).replaceAll('\\', '/') }))
orphans.sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name))

const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
// Намеренно экспортированные внутренности в долг не идут: нормативная формула
// проверяется тестом против своего пункта, и снять с неё экспорт значило бы
// удалить проверку.
const internal = new Set(previous?.internal ?? [])
const capabilities = orphans.filter((orphan) => !internal.has(orphan.name))
const baselineCount = previous?.capabilities ?? Number.POSITIVE_INFINITY

for (const orphan of capabilities) console.log(`${orphan.file}: ${orphan.name}`)
console.log(`\nвозможностей без пути с экрана: ${capabilities.length}`
  + (previous ? ` (уровень ${baselineCount})` : '')
  + `; внутренних, проверяемых напрямую: ${orphans.length - capabilities.length}`)

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    _comment: 'Возможности движка без пути с экрана. Может только снижаться; обновляется через npm run audit:reachability -- --write-baseline. Список internal — намеренно экспортированные внутренности, проверяемые тестом напрямую: в долг не идут.',
    capabilities: capabilities.length,
    internalCount: orphans.length - capabilities.length,
    functions: capabilities,
    internal: [...internal].sort(),
  }, null, 2)}\n`, 'utf8')
  console.log(`уровень записан: ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (capabilities.length > baselineCount) {
  const known = new Set((previous?.functions ?? []).map((item) => item.name))
  const added = capabilities.filter((orphan) => !known.has(orphan.name))
  console.error(`\nОшибка: недостижимых возможностей стало больше (${capabilities.length} против ${baselineCount}).`)
  if (added.length > 0) console.error(`Новые: ${added.map((item) => item.name).join(', ')}.`)
  console.error('Возможность не считается сделанной, пока к ней нет пути с экрана.')
  process.exit(1)
}
if (capabilities.length < baselineCount && previous) {
  console.log(`уровень снижен на ${baselineCount - capabilities.length}; запишите его: npm run audit:reachability -- --write-baseline`)
}
process.exit(0)

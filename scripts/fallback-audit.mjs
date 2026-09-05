#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Молчаливые подстановки в критических путях.
 *
 * Подстановка вместо отсутствия — самый дорогой класс ошибок в этом проекте, и
 * стоил он уже дорого. `ground_elevation ?? 0` на круге базы дал подряд четыре
 * симптома: «Земля 0.00» в профиле, уклон 0,00 ‰, нехватку падения 3,38 м и
 * «самотёк не обеспечен», — притом что настоящие отметки 688,22…685,21 м лежали
 * рядом нетронутыми. Расчёт был исправен: он считал ровно то, что ему дали.
 *
 * Показатель устроен как храповик достижимости и долга словарей: число может
 * только снижаться. Разом заменить всё нельзя, но новая подстановка не должна
 * появиться незаметно.
 *
 * КРИТИЧЕСКИЙ ПУТЬ — модуль, чьи значения попадают в чертёж, расчёт или
 * ведомость. Оформление (цвета, толщины, поля листа, тексты) не считается: там
 * дефолт — это и есть решение, а не подмена данных.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = join(ROOT, 'docs', 'fallback-baseline.json')

/**
 * Модули критического пути. Список ведётся руками и намеренно: «посчитать всё»
 * дало бы шум оформления, в котором настоящие подстановки утонут.
 */
const CRITICAL = [
  'engine/src/norms/gravity.ts',
  'engine/src/norms/gravity-branches.ts',
  'engine/src/norms/storm-runoff.ts',
  'engine/src/norms/storm-inlets.ts',
  'engine/src/norms/quantities.ts',
  'engine/src/norms/masterplan.ts',
  'engine/src/norms/pumps.ts',
  'engine/src/norms/drop-wells.ts',
  'engine/src/norms/vertplan.ts',
  'engine/src/pressure.ts',
  'engine/src/sizing.ts',
  'engine/src/hydraulics.ts',
  'engine/src/basin-links.ts',
  'engine/src/catalog.ts',
  'engine/src/manhole-catalog.ts',
  'engine/src/pump-catalog.ts',
  'engine/src/reconstruction.ts',
  'engine/src/reconstruction-from-survey.ts',
  'engine/src/reconstruction-profile.ts',
  'engine/src/existing-invert-tie.ts',
  'engine/src/existing-condition.ts',
  'engine/src/crossing-clearance.ts',
  'engine/src/crossing-triage.ts',
  'engine/src/crossings-from-survey.ts',
  'engine/src/geology.ts',
  'engine/src/geoprofile.ts',
  'engine/src/geocoverage.ts',
  'engine/src/consumption.ts',
  'engine/src/demand.ts',
  'engine/src/topography.ts',
  'engine/src/contours.ts',
  'engine/src/georef.ts',
  'engine/src/surveygrid.ts',
  'engine/src/source-head.ts',
  'engine/src/specification.ts',
  'frontend/src/shared/network.ts',
  'frontend/src/shared/existing.ts',
  'frontend/src/shared/catalog.ts',
  'frontend/src/shared/stankevichaSeed.ts',
  /*
    Виды, из которых инженерные величины уходят В ДВИЖОК.

    Сторож смотрел на движок и общие модули, а вызов расчёта собирают эти два
    файла — и обе подстановки 2,00 м жили здесь. Он не увидел ни одну: первую
    нашли глазами по чертежу, вторую владелец нашёл в исходнике. Закрыть случай,
    не заведя наблюдение за местом, значит ждать третью.
  */
  'frontend/src/app/project/GravitySection.tsx',
  'frontend/src/app/project/SituationSchemeSection.tsx',
]

/**
 * Формы молчаливой подстановки.
 *
 * Ищется подстановка ЧИСЛА или строки вместо отсутствующего значения. Формы
 * перечислены все, что встречались в этом коде, включая `Math.max` как способ
 * «взять хоть что-то» — так однажды выбиралась глубина промерзания.
 */
const PATTERNS = [
  { id: 'nullish-number', re: /\?\?\s*-?\d+(?:\.\d+)?(?!\s*\))/g },
  { id: 'or-number', re: /\|\|\s*-?\d+(?:\.\d+)?/g },
  { id: 'nullish-string', re: /\?\?\s*'[^']+'/g },
  { id: 'or-string', re: /\|\|\s*'[^']+'/g },
]

/**
 * Исключения: подстановки, признанные законными, с обоснованием у каждой.
 *
 * Ключ — `путь | сама строка кода`, а НЕ номер строки. Номер казался строже,
 * но оказался хрупким не в ту сторону: правка соседней функции сдвигала строки,
 * и семнадцать разобранных подстановок разом теряли обоснование, поднимая
 * храповик на ровном месте. Проверять надо код, а не его положение в файле.
 * Правка самой строки обоснование по-прежнему снимает — этого и добивались.
 */
const ALLOWED = JSON.parse(readFileSync(join(ROOT, 'docs', 'fallback-allowed.json'), 'utf8'))

/** Ключ исключения: файл и сама строка кода, без номера и без лишних пробелов. */
function allowKey(file, code) {
  return `${file} | ${code.trim().replace(/\s+/g, ' ')}`
}

/** Накопитель по своей же карте: дефолт — это определение пустой суммы. */
const ACCUMULATOR = /\.get\([^)]*\)\s*\?\?\s*0\s*\)?\s*[+\-]/
/** Счётчик длины/размера: отсутствие набора — это ноль элементов, а не подмена. */
const COUNTER = /(?:length|size|Count|count)\s*\?\?\s*0/

function findings() {
  const out = []
  for (const rel of CRITICAL) {
    const path = join(ROOT, ...rel.split('/'))
    if (!existsSync(path)) throw new Error(`Критический модуль не найден: ${rel}`)
    const source = readFileSync(path, 'utf8')
    const lines = source.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      // Комментарии не считаются: в них подстановки обсуждаются, а не делаются.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
      if (code.trim() === '' || code.trim().startsWith('*')) continue
      for (const pattern of PATTERNS) {
        pattern.re.lastIndex = 0
        for (const match of code.matchAll(pattern.re)) {
          const fragment = match[0].trim()
          if (ACCUMULATOR.test(code) || COUNTER.test(code)) continue
          const key = allowKey(rel, code)
          if (ALLOWED[key]) continue
          out.push({ file: rel, line: index + 1, fragment, pattern: pattern.id, code: code.trim() })
        }
      }
    }
  }
  return out
}

const found = findings()
const level = found.length
const write = process.argv.includes('--write-baseline')

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { fallbacks: level, note: '' }

if (write) {
  writeFileSync(BASELINE, `${JSON.stringify({
    _comment: 'Молчаливые подстановки в критических путях. Может только снижаться;'
      + ' обновляется через npm run audit:fallbacks -- --write-baseline.'
      + ' Законные подстановки перечислены в docs/fallback-allowed.json с обоснованием у каждой.',
    fallbacks: level,
    files: [...new Set(found.map((item) => item.file))].sort(),
  }, null, 2)}\n`, 'utf8')
  console.log(`Базовый уровень записан: ${level}`)
  process.exit(0)
}

if (process.argv.includes('--list')) {
  for (const item of found) {
    console.log(`${item.file}:${item.line}  ${item.fragment}   ${item.code.slice(0, 110)}`)
  }
}

const byFile = new Map()
for (const item of found) byFile.set(item.file, (byFile.get(item.file) ?? 0) + 1)
for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)}  ${file.split('/').join(sep)}`)
}
console.log(`\nмолчаливых подстановок в критических путях: ${level} (уровень ${baseline.fallbacks})`)
console.log(`законных, с обоснованием: ${Object.keys(ALLOWED).length}`)

if (level > baseline.fallbacks) {
  console.error(`\nПодстановок стало больше: ${level} против ${baseline.fallbacks}.`)
  console.error('Отсутствие данных не должно превращаться в значение. Либо тип допускает'
    + ' отсутствие и потребитель получает стоп-фактор, либо подстановка законна —'
    + ' тогда впишите её в docs/fallback-allowed.json с обоснованием.')
  process.exit(1)
}
console.log(relative(ROOT, BASELINE))

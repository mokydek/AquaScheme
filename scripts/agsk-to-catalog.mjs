#!/usr/bin/env node
/**
 * Каталог труб проекта из выгрузки АГСК-3.
 *
 * Берёт то, что извлёк `extract-agsk.mjs`, и оставляет ТОЛЬКО позиции, у
 * которых в наименовании назван и стандарт, и диаметр. Позиция-заголовок
 * группы (код с нулём на конце, без DN) в каталог не идёт: диаметра у неё нет,
 * и подбирать по ней нечего.
 *
 *   node scripts/agsk-to-catalog.mjs <выгрузка.json> <стандарт> <материал> <выход.csv>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [inPath, standard, material, outPath] = process.argv.slice(2)
if (!inPath || !standard || !material || !outPath) {
  console.error('Использование: node scripts/agsk-to-catalog.mjs <выгрузка.json> <стандарт> <материал> <выход.csv>')
  process.exit(2)
}
const { entries } = JSON.parse(readFileSync(inPath, 'utf8'))
const rows = []
for (const entry of entries) {
  if (!entry.name.includes(standard)) continue
  // «DN/ID» в наименовании — заявление самого справочника: условный проход и
  // внутренний диаметр у этой позиции совпадают.
  const dn = /DN\/ID\s*(\d{3,4})/.exec(entry.name)
  if (!dn) continue
  rows.push({ dn: Number(dn[1]), code: entry.code, page: entry.page, name: entry.name })
}
// Один диаметр встречается в нескольких группах по несущей способности.
// Каталогу подбора нужен ряд диаметров, поэтому на диаметр остаётся первая
// позиция, а её код называет, какая именно.
const seen = new Set()
const unique = rows.filter((row) => (seen.has(row.dn) ? false : (seen.add(row.dn), true)))
unique.sort((a, b) => a.dn - b.dn)

const csv = [
  'Тип;Материал;Стандарт;Код;Страница;DN;ID',
  ...unique.map((row) => `труба;${material};${standard};${row.code};${row.page};${row.dn};${row.dn}`),
].join('\n')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${csv}\n`, 'utf8')
console.log(`позиций в каталоге: ${unique.length}; ряд: ${unique.map((row) => row.dn).join(', ')}`)

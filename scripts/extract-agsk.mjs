#!/usr/bin/env node
/**
 * Извлечение позиций каталога АГСК-3 из официального PDF.
 *
 * Разбор идёт ПО КОЛОНКАМ, а не по строкам. Позиция каталога занимает две-три
 * визуальные строки, и склейка по одной координате Y перемешивает их: единица
 * измерения из соседней колонки влезала в середину наименования, а «DN/ID 2000»
 * обрезалось. У каждой ячейки своя координата X, границы колонок постоянны на
 * всех страницах раздела — по ним и режем.
 *
 * Границы колонок берутся из САМИХ ДАННЫХ, а не из шапки: заголовки «Код |
 * Наименование | Стандарт | Ед. изм.» отцентрованы над своими колонками, а
 * содержимое прижато влево, и по шапке границы не совпадают — первая попытка
 * дала 9 позиций вместо 96. Код позиции узнаётся по виду (три группы цифр через
 * дефис) и задаёт левую границу; единица измерения стоит у правого края листа.
 *
 * Наименование — абзац из двух-трёх строк, и его строки стоят вплотную к своему
 * коду, а до соседнего кода вдвое дальше. Поэтому каждая строка приписывается
 * ближайшему по вертикали коду. Страница без единого кода пропускается с
 * названной причиной, а не разбирается наугад.
 *
 * Путь к PDF передаётся аргументом: файл конфиденциальный и в репозиторий не
 * попадает.
 *
 *   node scripts/extract-agsk.mjs <путь-к-PDF> <первая> <последняя> <выход.json>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [pdfPath, fromArg, toArg, outPath] = process.argv.slice(2)
if (!pdfPath || !fromArg || !toArg || !outPath) {
  console.error('Использование: node scripts/extract-agsk.mjs <PDF> <первая> <последняя> <выход.json>')
  process.exit(2)
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise

/** Код позиции АГСК-3: три группы цифр через дефис. */
const CODE = /^\d{3}-\d{3}-\d{4}$/

/**
 * Колонка «Код» — самая левая.
 *
 * Границу берём из данных, а не из шапки: заголовки отцентрованы над своими
 * колонками, а содержимое прижато влево, и по шапке границы не совпадают. Код
 * стоит заметно левее наименования — этого достаточно и никаких допущений о
 * вёрстке не требует.
 */
function codeColumnEdge(items) {
  const codeXs = items.filter((item) => CODE.test(item.text)).map((item) => item.x)
  if (codeXs.length === 0) return null
  const rightmostCode = Math.max(...codeXs)
  return rightmostCode + 5
}

/**
 * Служебный текст листа: шапка таблицы, колонтитул, отметки продолжения.
 *
 * Он стоит на тех же координатах, что и содержимое, и без отсева приписывается
 * ближайшему коду — в наименовании появлялось «Окончание таблицы Код
 * Наименование Стандарт Ед. изм.».
 */
const CHROME = /^(АГСК-3|Код|Наименование|Стандарт|Ед\.\s*изм\.|Продолжение таблицы|Окончание таблицы|Начало таблицы)$/

function itemsOf(content) {
  return content.items
    .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .filter((item) => !CHROME.test(item.text))
}

const from = Number(fromArg)
const to = Number(toArg)
const entries = []
const skipped = []

/**
 * Единица измерения стоит у правого края листа, далеко от наименования.
 * Порог берётся из самой страницы: правее середины ширины текста.
 */
for (let page = from; page <= Math.min(to, doc.numPages); page++) {
  const pdfPage = await doc.getPage(page)
  const content = await pdfPage.getTextContent()
  const items = itemsOf(content)
  const codeEdge = codeColumnEdge(items)
  if (codeEdge === null) {
    skipped.push({ page, reason: 'на странице нет ни одного кода позиции' })
    continue
  }
  const width = pdfPage.getViewport({ scale: 1 }).width
  const unitEdge = width * 0.8

  const codes = items.filter((item) => CODE.test(item.text)).sort((a, b) => b.y - a.y)
  const perCode = new Map(codes.map((code) => [code.text, { code: code.text, page, y: code.y, parts: [], unit: '' }]))

  for (const item of items) {
    if (CODE.test(item.text)) continue
    if (item.x < codeEdge) continue // прочий текст левой колонки
    // Ближайший по вертикали код: наименование позиции — это абзац, чьи строки
    // стоят вплотную к своему коду, а до соседнего кода вдвое дальше.
    let nearest = null
    let best = Infinity
    for (const code of codes) {
      const distance = Math.abs(code.y - item.y)
      if (distance < best) { best = distance; nearest = code }
    }
    if (!nearest) continue
    const entry = perCode.get(nearest.text)
    if (item.x >= unitEdge) entry.unit = entry.unit === '' ? item.text : `${entry.unit} ${item.text}`
    else entry.parts.push({ y: item.y, text: item.text })
  }

  for (const code of codes) {
    const entry = perCode.get(code.text)
    entry.parts.sort((a, b) => b.y - a.y)
    entries.push({
      code: entry.code,
      page: entry.page,
      name: entry.parts.map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim(),
      unit: entry.unit.trim(),
    })
  }
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify({ source: pdfPath, from, to, entries, skipped }, null, 1)}\n`, 'utf8')
console.log(`позиций: ${entries.length}; страниц пропущено: ${skipped.length}`)
for (const item of skipped) console.log(`  пропуск с.${item.page}: ${item.reason}`)
await doc.destroy()

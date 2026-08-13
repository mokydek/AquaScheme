#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { scoreRgba, summarizePageScores } from './visual-score.mjs'
import {
  DEFAULT_OVERLAP_THRESHOLD,
  classifySheet,
  commonWindow,
  matchSheets,
  parsePicketRange,
  parseReferenceRegister,
} from './sheet-matching.mjs'

/**
 * Сравнение альбома с эталоном.
 *
 * По умолчанию листы сопоставляются ПО СОДЕРЖАНИЮ — по перекрытию пикетных
 * диапазонов, — а не по номеру страницы. Основание: нарезка альбома на листы
 * есть производная данных (длина оси, положение узлов), а не оформления; наша
 * ось длиннее эталонной на 3,4 %, поэтому страница N у нас и страница N у
 * эталона показывают разные участки трассы. Постраничное сравнение при таком
 * сдвиге систематически наказывает СОДЕРЖИМОЕ за нарезку: безупречно
 * нарисованный лист получает низкий ink просто потому, что участок другой.
 *
 * Старый режим сохранён флагом `--by-page` — история измерений остаётся
 * сравнимой, и оба числа считаются рядом.
 *
 * Формулы pixel / ink / structure не менялись: меняется только то, что с чем
 * сравнивается и в каком окне.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BENCHMARK = join(ROOT, 'docs', 'benchmark')
const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const manifestPath = resolve(positional[0] ?? join(BENCHMARK, 'manifest.json'))
if (!existsSync(manifestPath)) {
  console.error(`visual-benchmark: manifest not found: ${manifestPath}`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const selfTest = process.argv.includes('--self-test')
const byPage = process.argv.includes('--by-page')
const resolveInput = (value) => {
  if (!value || typeof value !== 'string') throw new Error('Manifest must define referencePdf and generatedPdf.')
  return isAbsolute(value) ? value : resolve(dirname(manifestPath), value)
}
const referencePath = resolveInput(manifest.referencePdf)
const generatedPath = resolveInput(manifest.generatedPdf)
for (const path of [referencePath, generatedPath]) {
  if (!existsSync(path)) throw new Error(`PDF not found: ${path}`)
}

const width = manifest.renderWidthPx ?? 1000
const height = manifest.renderHeightPx ?? 707
const threshold = manifest.visualThreshold ?? 0.99
const expectedPages = manifest.expectedPages ?? 61
const overlapThreshold = manifest.overlapThreshold ?? DEFAULT_OVERLAP_THRESHOLD
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const referenceSha256 = sha256(referencePath)
const generatedSha256 = sha256(generatedPath)
if (!selfTest) {
  if (resolve(referencePath) === resolve(generatedPath) || referenceSha256 === generatedSha256) {
    throw new Error('Acceptance benchmark requires different reference and generated PDF files. Use --self-test only for metric verification.')
  }
  if (expectedPages !== 61) throw new Error(`Acceptance benchmark requires expectedPages=61, received ${expectedPages}.`)
  if (!(threshold >= 0.99 && threshold <= 1)) throw new Error(`Acceptance benchmark requires visualThreshold in [0.99, 1], received ${threshold}.`)
  if (width < 1000 || height < 707) throw new Error(`Acceptance render is too small: ${width}x${height}; minimum is 1000x707.`)
}

const PT_PER_MM = 72 / 25.4
/** Масштаб планов и профилей по горизонтали: 1 м трассы = 2 мм бумаги. */
const PLAN_MM_PER_METRE = 1000 / 500

async function openPdf(path) {
  const data = new Uint8Array(readFileSync(path))
  return getDocument({ data, useSystemFonts: true }).promise
}

async function renderNormalized(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(width / base.width, height / base.height)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  const dx = (width - viewport.width) / 2
  const dy = (height - viewport.height) / 2
  await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, dx, dy] }).promise
  return {
    pixels: context.getImageData(0, 0, width, height).data,
    png: canvas.toBuffer('image/png'),
    pageSizePt: { width: base.width, height: base.height },
  }
}

/**
 * Левый край чернил страницы, pt.
 *
 * Служит началом чертёжного поля: рамка листа — самый левый элемент и у нас, и
 * у эталона, а чертёж начинается вплотную за ней. Правило одно на обе стороны —
 * иначе сопоставление перестало бы быть симметричным.
 *
 * Это ПРИБЛИЖЕНИЕ: зазор «рамка → чертёж» неизвестен и на наших листах равен
 * 5,9 мм, то есть 3 м трассы при 1:500. Точнее взять неоткуда: текст
 * эталонных планов переведён в кривые, и пикетную разметку на них не прочитать.
 */
const inkLeftCache = new Map()
async function inkLeftPt(pdf, pageNumber, key) {
  const cacheKey = `${key}:${pageNumber}`
  if (inkLeftCache.has(cacheKey)) return inkLeftCache.get(cacheKey)
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const probeWidth = 1400
  const scale = probeWidth / base.width
  const probeHeight = Math.max(1, Math.round(base.height * scale))
  const canvas = createCanvas(probeWidth, probeHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, probeWidth, probeHeight)
  await page.render({ canvasContext: context, viewport: page.getViewport({ scale }) }).promise
  const pixels = context.getImageData(0, 0, probeWidth, probeHeight).data
  let leftColumn = null
  for (let x = 0; x < probeWidth && leftColumn === null; x++) {
    for (let y = 0; y < probeHeight; y++) {
      const offset = (y * probeWidth + x) * 4
      const grey = 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]
      if (grey < 245) { leftColumn = x; break }
    }
  }
  const value = leftColumn === null ? 0 : leftColumn / scale
  inkLeftCache.set(cacheKey, value)
  return value
}

/**
 * Отрисовка страницы в общем пикетном окне.
 *
 * Обе страницы кладутся в один холст в одном масштабе: 1 м трассы занимает
 * одинаковое число точек, а начало окна совмещено с началом окна. Именно это и
 * снимает наказание за сдвиг нарезки.
 */
async function renderPicketWindow(pdf, pageNumber, sheetRange, window, canvasWidth, canvasHeight, key) {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const windowWidthPt = (window.toM - window.fromM) * PLAN_MM_PER_METRE * PT_PER_MM
  const scale = canvasWidth / windowWidthPt
  const left = await inkLeftPt(pdf, pageNumber, key)
  const originPt = left + (window.fromM - sheetRange.fromM) * PLAN_MM_PER_METRE * PT_PER_MM
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(canvasWidth, canvasHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvasWidth, canvasHeight)
  const dy = (canvasHeight - viewport.height) / 2
  await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -originPt * scale, dy] }).promise
  return {
    pixels: context.getImageData(0, 0, canvasWidth, canvasHeight).data,
    png: canvas.toBuffer('image/png'),
    pageSizePt: { width: base.width, height: base.height },
  }
}

function differencePng(referencePixels, generatedPixels, canvasWidth, canvasHeight) {
  const canvas = createCanvas(canvasWidth, canvasHeight)
  const context = canvas.getContext('2d')
  const image = context.createImageData(canvasWidth, canvasHeight)
  for (let offset = 0; offset < referencePixels.length; offset += 4) {
    const delta = Math.max(
      Math.abs(referencePixels[offset] - generatedPixels[offset]),
      Math.abs(referencePixels[offset + 1] - generatedPixels[offset + 1]),
      Math.abs(referencePixels[offset + 2] - generatedPixels[offset + 2]),
    )
    if (delta < 8) {
      const gray = Math.round((generatedPixels[offset] + generatedPixels[offset + 1] + generatedPixels[offset + 2]) / 3)
      const pale = 235 + Math.round(gray * 20 / 255)
      image.data.set([pale, pale, pale, 255], offset)
    } else {
      image.data.set([255, Math.max(0, 210 - delta), Math.max(0, 210 - delta), 255], offset)
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toBuffer('image/png')
}

/** Названия листов PDF: первая содержательная строка страницы. */
async function readSheets(pdf) {
  const sheets = []
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent()
    const title = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim()
    sheets.push({ page, title, family: classifySheet(title), range: parsePicketRange(title.slice(0, 120)) })
  }
  return sheets
}

const reference = await openPdf(referencePath)
const generated = await openPdf(generatedPath)
// Расхождение в числе страниц раньше прекращало работу до всякого измерения.
// Из-за этого показатель совпадения нельзя было получить, пока альбом не
// совпадёт с эталоном полностью, — то есть инструмент не мерил прогресс, а
// только подтверждал финиш. Теперь несовпадение состава входит в отчёт и само
// по себе валит приёмку.
const pageCountMatch = reference.numPages === expectedPages && generated.numPages === expectedPages
if (!pageCountMatch) {
  console.error(`visual-benchmark: состав не совпал; ожидалось ${expectedPages}, эталон ${reference.numPages}, сгенерировано ${generated.numPages}.`)
}

const artifactRoot = resolve(dirname(manifestPath), manifest.visualArtifacts ?? 'out/artifacts')
const referencePages = join(artifactRoot, 'reference-pages')
const generatedPages = join(artifactRoot, 'generated-pages')
const differencePages = join(artifactRoot, 'diff-pages')
for (const directory of [referencePages, generatedPages, differencePages]) mkdirSync(directory, { recursive: true })

const pages = []
let matching = null

if (byPage) {
  const comparedPages = Math.min(reference.numPages, generated.numPages)
  if (comparedPages === 0) {
    console.error('visual-benchmark: сравнивать нечего — в одном из файлов нет страниц.')
    process.exit(1)
  }
  for (let page = 1; page <= comparedPages; page++) {
    const [referenceRender, generatedRender] = await Promise.all([
      renderNormalized(reference, page),
      renderNormalized(generated, page),
    ])
    const metrics = scoreRgba(referenceRender.pixels, generatedRender.pixels, width, height)
    const pageSizeMatch = Math.abs(referenceRender.pageSizePt.width - generatedRender.pageSizePt.width) <= 0.5
      && Math.abs(referenceRender.pageSizePt.height - generatedRender.pageSizePt.height) <= 0.5
    pages.push({
      page,
      ...metrics,
      pageSizeMatch,
      referencePage: page,
      generatedPage: page,
      referencePageSizePt: referenceRender.pageSizePt,
      generatedPageSizePt: generatedRender.pageSizePt,
      passed: pageSizeMatch && metrics.combined >= threshold,
    })
    const basename = `page-${String(page).padStart(2, '0')}.png`
    writeFileSync(join(referencePages, basename), referenceRender.png)
    writeFileSync(join(generatedPages, basename), generatedRender.png)
    writeFileSync(join(differencePages, basename), differencePng(referenceRender.pixels, generatedRender.pixels, width, height))
    console.log(`page ${String(page).padStart(2, '0')}: ${(metrics.combined * 100).toFixed(3)}%${pageSizeMatch ? '' : ' · MEDIA BOX MISMATCH'}`)
  }
} else {
  const generatedSheets = await readSheets(generated)
  // Эталон читается из ведомости, а не из PDF: текст его план-листов переведён
  // в кривые, и названия оттуда не извлекаются. Из ведомости берётся ТОЛЬКО
  // состав — что с чем сравнивать; инженерные величины эталона в проект не
  // попадают.
  //
  // `referenceRegister: "pdf"` читает названия прямо из эталонного PDF. Это
  // нужно самотестам, где «эталоном» служит синтетический альбом с текстовым
  // слоем, и режим совпадения файлов на входе.
  const registerSetting = manifest.referenceRegister ?? 'ETALON-SHEETS.md'
  const fromPdf = registerSetting === 'pdf' || (selfTest && referenceSha256 === generatedSha256)
  let referenceSheets
  if (fromPdf) {
    referenceSheets = await readSheets(reference)
  } else {
    const registerPath = resolve(dirname(manifestPath), registerSetting)
    if (!existsSync(registerPath)) {
      throw new Error(`Пикетное сопоставление требует ведомость эталона: ${registerPath}. Постраничный режим доступен флагом --by-page.`)
    }
    referenceSheets = parseReferenceRegister(readFileSync(registerPath, 'utf8'))
  }
  matching = matchSheets(generatedSheets, referenceSheets, { threshold: overlapThreshold })

  for (const [index, pair] of matching.pairs.entries()) {
    const window = commonWindow(pair)
    let referenceRender
    let generatedRender
    let canvasWidth = width
    let canvasHeight = height
    if (window) {
      const windowWidthPt = (window.toM - window.fromM) * PLAN_MM_PER_METRE * PT_PER_MM
      const referencePage = await reference.getPage(pair.referencePage)
      const generatedPage = await generated.getPage(pair.generatedPage)
      const tallestPt = Math.max(referencePage.getViewport({ scale: 1 }).height, generatedPage.getViewport({ scale: 1 }).height)
      canvasHeight = Math.min(1400, Math.max(80, Math.round(canvasWidth * tallestPt / windowWidthPt)))
      ;[referenceRender, generatedRender] = await Promise.all([
        renderPicketWindow(reference, pair.referencePage, pair.referenceRange, window, canvasWidth, canvasHeight, 'ref'),
        renderPicketWindow(generated, pair.generatedPage, pair.generatedRange, window, canvasWidth, canvasHeight, 'gen'),
      ])
    } else {
      ;[referenceRender, generatedRender] = await Promise.all([
        renderNormalized(reference, pair.referencePage),
        renderNormalized(generated, pair.generatedPage),
      ])
    }
    const metrics = scoreRgba(referenceRender.pixels, generatedRender.pixels, canvasWidth, canvasHeight)
    const pageSizeMatch = Math.abs(referenceRender.pageSizePt.width - generatedRender.pageSizePt.width) <= 0.5
      && Math.abs(referenceRender.pageSizePt.height - generatedRender.pageSizePt.height) <= 0.5
    pages.push({
      page: index + 1,
      ...metrics,
      pageSizeMatch,
      referencePage: pair.referencePage,
      generatedPage: pair.generatedPage,
      family: pair.family,
      basis: pair.basis,
      overlap: pair.overlap,
      window,
      referencePageSizePt: referenceRender.pageSizePt,
      generatedPageSizePt: generatedRender.pageSizePt,
      passed: metrics.combined >= threshold,
    })
    const basename = `pair-${String(index + 1).padStart(2, '0')}.png`
    writeFileSync(join(referencePages, basename), referenceRender.png)
    writeFileSync(join(generatedPages, basename), generatedRender.png)
    writeFileSync(join(differencePages, basename), differencePng(referenceRender.pixels, generatedRender.pixels, canvasWidth, canvasHeight))
    console.log(`пара ${String(index + 1).padStart(2, '0')}: наш ${pair.generatedPage} ↔ эталон ${pair.referencePage}`
      + `${pair.overlap === null ? ' (по семейству)' : ` (перекрытие ${(pair.overlap * 100).toFixed(1)} %)`}`
      + `: ${(metrics.combined * 100).toFixed(3)}%`)
  }

  // Лист без пары не выбрасывается: он входит в среднее нулём. Несравнимое
  // наказывается явно, иначе выборочное сравнение показывало бы тем более
  // высокое сходство, чем сильнее разошёлся состав.
  for (const orphan of [...matching.unmatchedGenerated.map((sheet) => ({ ...sheet, side: 'generated' })),
    ...matching.unmatchedReference.map((sheet) => ({ ...sheet, side: 'reference' }))]) {
    pages.push({
      page: pages.length + 1,
      pixelSimilarity: 0,
      inkIoU: 0,
      structureSimilarity: 0,
      combined: 0,
      pageSizeMatch: false,
      referencePage: orphan.side === 'reference' ? orphan.page : null,
      generatedPage: orphan.side === 'generated' ? orphan.page : null,
      family: orphan.family,
      basis: 'unmatched',
      unmatchedSide: orphan.side,
      unmatchedReason: orphan.reason,
      passed: false,
    })
    console.log(`без пары (${orphan.side === 'reference' ? 'эталон' : 'наш'} ${orphan.page}, ${orphan.family}): ${orphan.reason} → 0%`)
  }
}

if (pages.length === 0) {
  console.error('visual-benchmark: сравнивать нечего.')
  process.exit(1)
}

const summary = summarizePageScores(pages)
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: byPage ? 'by-page' : 'by-picket',
  inputs: {
    reference: { role: 'R01', sha256: referenceSha256 },
    generated: { role: 'generatedPdf', sha256: generatedSha256 },
  },
  render: { width, height, useSystemFonts: true },
  threshold,
  overlapThreshold,
  expectedPages,
  pageCount: {
    expected: expectedPages,
    reference: reference.numPages,
    generated: generated.numPages,
    match: pageCountMatch,
  },
  matching: matching
    ? {
      pairs: matching.pairs,
      unmatchedGenerated: matching.unmatchedGenerated,
      unmatchedReference: matching.unmatchedReference,
    }
    : null,
  summary,
  // Приёмка не смягчена: несовпадение состава валит её так же, как и раньше.
  passed: pageCountMatch && pages.every((page) => page.passed) && summary.average.combined >= threshold,
  pages,
}
const reportPath = resolve(dirname(manifestPath), manifest.visualReport ?? 'out/reports/page-comparison.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const htmlPath = resolve(dirname(reportPath), manifest.visualHtmlReport ?? 'page-comparison.html')
const picket = (metres) => {
  if (metres === null || metres === undefined) return '—'
  const hundreds = Math.floor(metres / 100)
  const rest = Math.round((metres - hundreds * 100) * 100) / 100
  return rest === 0 ? `ПК${hundreds}` : `ПК${hundreds}+${rest}`
}
const rangeText = (range) => range ? `${picket(range.fromM)}–${picket(range.toM)}` : '—'
const rows = pages.map((page) => {
  const basename = byPage
    ? `page-${String(page.page).padStart(2, '0')}.png`
    : `pair-${String(page.page).padStart(2, '0')}.png`
  const link = (directory) => relative(dirname(htmlPath), join(directory, basename)).replaceAll('\\', '/')
  const label = page.basis === 'unmatched'
    ? `без пары (${page.unmatchedSide === 'reference' ? 'эталон' : 'наш'} ${page.referencePage ?? page.generatedPage})`
    : `${page.generatedPage} ↔ ${page.referencePage}`
  const artifacts = page.basis === 'unmatched'
    ? '—'
    : `<a href="${link(referencePages)}">reference</a> · <a href="${link(generatedPages)}">generated</a> · <a href="${link(differencePages)}">diff</a>`
  return `<tr class="${page.passed ? 'pass' : 'fail'}"><td>${label}</td><td>${page.overlap === null || page.overlap === undefined ? '—' : `${(page.overlap * 100).toFixed(1)}%`}</td><td>${(page.pixelSimilarity * 100).toFixed(3)}%</td><td>${(page.inkIoU * 100).toFixed(3)}%</td><td>${(page.structureSimilarity * 100).toFixed(3)}%</td><td>${(page.combined * 100).toFixed(3)}%</td><td>${page.passed ? 'PASS' : 'FAIL'}</td><td>${artifacts}</td></tr>`
}).join('\n')
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AquaScheme visual benchmark</title><style>body{font:14px system-ui;margin:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}.fail{background:#ffe5e5}.pass{background:#effbef}a{color:#0645ad}</style></head><body><h1>AquaScheme visual benchmark</h1><p>Режим: ${report.mode}. Порог ${(threshold * 100).toFixed(3)} %; средний ${(summary.average.combined * 100).toFixed(3)} %; худший ${(summary.minimum.combined * 100).toFixed(3)} %.</p><table><thead><tr><th>Пара</th><th>Перекрытие</th><th>RGB pixels</th><th>Ink IoU</th><th>Structure</th><th>Combined</th><th>Status</th><th>Artifacts</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
writeFileSync(htmlPath, html, 'utf8')
const markdownPath = resolve(dirname(reportPath), manifest.visualMarkdownReport ?? 'final-validation.md')
const markdownRows = pages.map((page) => {
  const label = page.basis === 'unmatched'
    ? `без пары (${page.unmatchedSide === 'reference' ? 'эталон' : 'наш'} ${page.referencePage ?? page.generatedPage})`
    : `${page.generatedPage} ↔ ${page.referencePage}`
  const reason = page.basis === 'unmatched'
    ? page.unmatchedReason
    : page.passed ? '—' : 'сходство ниже порога'
  return `| ${label} | ${page.overlap === null || page.overlap === undefined ? '—' : `${(page.overlap * 100).toFixed(1)}%`} | ${(page.pixelSimilarity * 100).toFixed(3)}% | ${(page.inkIoU * 100).toFixed(3)}% | ${(page.structureSimilarity * 100).toFixed(3)}% | ${(page.combined * 100).toFixed(3)}% | ${page.passed ? 'PASS' : 'FAIL'} | ${reason} |`
}).join('\n')
const pairRows = matching
  ? matching.pairs.map((pair) =>
    `| ${pair.generatedPage} (${rangeText(pair.generatedRange)}) | ${pair.referencePage} (${rangeText(pair.referenceRange)}) | ${pair.family} | ${pair.overlap === null ? 'по семейству' : `${(pair.overlap * 100).toFixed(1)}%`} |`).join('\n')
  : ''
const markdown = `# AquaScheme final visual validation\n\nGenerated: ${report.generatedAt}  \nРежим: **${report.mode}**  \nExpected pages: ${expectedPages}  \nThreshold: ${(threshold * 100).toFixed(3)} %  \nAverage: ${(summary.average.combined * 100).toFixed(3)} %  \nWorst: ${(summary.minimum.combined * 100).toFixed(3)} %  \nResult: **${report.passed ? 'PASS' : 'FAIL'}**\n\nThis report covers rendered visual similarity only. Engineering values, source provenance and normative applicability remain independent mandatory gates.\n\n${matching ? `## Пары листов\n\n| Наш лист | Эталонный лист | Семейство | Перекрытие |\n| --- | --- | --- | ---: |\n${pairRows}\n\n` : ''}## Сравнение\n\n| Пара | Перекрытие | RGB pixel | Ink IoU | Structure | Overall | Result | Примечание |\n| --- | ---: | ---: | ---: | ---: | ---: | :---: | --- |\n${markdownRows}\n`
writeFileSync(markdownPath, markdown, 'utf8')
if (matching) {
  console.log(`пар: ${matching.pairs.length}; без пары: наших ${matching.unmatchedGenerated.length}, эталонных ${matching.unmatchedReference.length}`)
}
console.log(`режим: ${report.mode}; страниц эталона ${reference.numPages}, наших ${generated.numPages}`)
console.log(`average: ${(summary.average.combined * 100).toFixed(3)}%; worst: ${(summary.minimum.combined * 100).toFixed(3)}%`)
console.log(`report: ${reportPath}`)
console.log(`html: ${htmlPath}`)
console.log(`markdown: ${markdownPath}`)
console.log(`diff pages: ${differencePages}`)
process.exit(report.passed ? 0 : 1)

#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { scoreRgba, summarizePageScores } from './visual-score.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BENCHMARK = join(ROOT, 'docs', 'benchmark')
const manifestPath = resolve(process.argv[2] ?? join(BENCHMARK, 'manifest.json'))
if (!existsSync(manifestPath)) {
  console.error(`visual-benchmark: manifest not found: ${manifestPath}`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const selfTest = process.argv.includes('--self-test')
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

function differencePng(referencePixels, generatedPixels) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const image = context.createImageData(width, height)
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

const reference = await openPdf(referencePath)
const generated = await openPdf(generatedPath)
// Расхождение в числе страниц раньше прекращало работу до всякого измерения.
// Из-за этого показатель совпадения нельзя было получить, пока альбом не
// совпадёт с эталоном полностью, — то есть инструмент не мерил прогресс, а
// только подтверждал финиш. Теперь сравниваются общие страницы, а несовпадение
// состава входит в отчёт и само по себе валит приёмку.
const pageCountMatch = reference.numPages === expectedPages && generated.numPages === expectedPages
if (!pageCountMatch) {
  console.error(`visual-benchmark: состав не совпал; ожидалось ${expectedPages}, эталон ${reference.numPages}, сгенерировано ${generated.numPages}. Сравниваются общие страницы.`)
}
const comparedPages = Math.min(reference.numPages, generated.numPages)
if (comparedPages === 0) {
  console.error('visual-benchmark: сравнивать нечего — в одном из файлов нет страниц.')
  process.exit(1)
}

const pages = []
const artifactRoot = resolve(dirname(manifestPath), manifest.visualArtifacts ?? 'out/artifacts')
const referencePages = join(artifactRoot, 'reference-pages')
const generatedPages = join(artifactRoot, 'generated-pages')
const differencePages = join(artifactRoot, 'diff-pages')
for (const directory of [referencePages, generatedPages, differencePages]) mkdirSync(directory, { recursive: true })
for (let page = 1; page <= comparedPages; page++) {
  const [referenceRender, generatedRender] = await Promise.all([
    renderNormalized(reference, page),
    renderNormalized(generated, page),
  ])
  const referencePixels = referenceRender.pixels
  const generatedPixels = generatedRender.pixels
  const metrics = scoreRgba(referencePixels, generatedPixels, width, height)
  const pageSizeMatch = Math.abs(referenceRender.pageSizePt.width - generatedRender.pageSizePt.width) <= 0.5
    && Math.abs(referenceRender.pageSizePt.height - generatedRender.pageSizePt.height) <= 0.5
  pages.push({
    page,
    ...metrics,
    pageSizeMatch,
    referencePageSizePt: referenceRender.pageSizePt,
    generatedPageSizePt: generatedRender.pageSizePt,
    passed: pageSizeMatch && metrics.combined >= threshold,
  })
  const basename = `page-${String(page).padStart(2, '0')}.png`
  writeFileSync(join(referencePages, basename), referenceRender.png)
  writeFileSync(join(generatedPages, basename), generatedRender.png)
  writeFileSync(join(differencePages, basename), differencePng(referencePixels, generatedPixels))
  console.log(`page ${String(page).padStart(2, '0')}: ${(metrics.combined * 100).toFixed(3)}%${pageSizeMatch ? '' : ' · MEDIA BOX MISMATCH'}`)
}

const summary = summarizePageScores(pages)
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputs: {
    reference: { role: 'R01', sha256: referenceSha256 },
    generated: { role: 'generatedPdf', sha256: generatedSha256 },
  },
  render: { width, height, useSystemFonts: true },
  threshold,
  expectedPages,
  pageCount: {
    expected: expectedPages,
    reference: reference.numPages,
    generated: generated.numPages,
    compared: comparedPages,
    match: pageCountMatch,
  },
  summary,
  // Приёмка не смягчена: несовпадение состава валит её так же, как и раньше.
  passed: pageCountMatch && pages.every((page) => page.passed) && summary.average.combined >= threshold,
  pages,
}
const reportPath = resolve(dirname(manifestPath), manifest.visualReport ?? 'out/reports/page-comparison.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const htmlPath = resolve(dirname(reportPath), manifest.visualHtmlReport ?? 'page-comparison.html')
const rows = pages.map((page) => {
  const basename = `page-${String(page.page).padStart(2, '0')}.png`
  const link = (directory) => relative(dirname(htmlPath), join(directory, basename)).replaceAll('\\', '/')
  return `<tr class="${page.passed ? 'pass' : 'fail'}"><td>${page.page}</td><td>${page.pageSizeMatch ? 'MATCH' : 'MISMATCH'}</td><td>${(page.pixelSimilarity * 100).toFixed(3)}%</td><td>${(page.inkIoU * 100).toFixed(3)}%</td><td>${(page.structureSimilarity * 100).toFixed(3)}%</td><td>${(page.combined * 100).toFixed(3)}%</td><td>${page.passed ? 'PASS' : 'FAIL'}</td><td><a href="${link(referencePages)}">reference</a> · <a href="${link(generatedPages)}">generated</a> · <a href="${link(differencePages)}">diff</a></td></tr>`
}).join('\n')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AquaScheme visual benchmark</title><style>body{font:14px system-ui;margin:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:right}th:first-child,td:first-child{text-align:center}.fail{background:#ffe5e5}.pass{background:#effbef}a{color:#0645ad}</style></head><body><h1>AquaScheme visual benchmark</h1><p>Threshold ${(threshold * 100).toFixed(3)}%; average ${(summary.average.combined * 100).toFixed(3)}%; worst ${(summary.minimum.combined * 100).toFixed(3)}%.</p><table><thead><tr><th>Page</th><th>MediaBox</th><th>RGB pixels</th><th>Ink IoU</th><th>Structure</th><th>Combined</th><th>Status</th><th>Artifacts</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
writeFileSync(htmlPath, html, 'utf8')
const markdownPath = resolve(dirname(reportPath), manifest.visualMarkdownReport ?? 'final-validation.md')
const markdownRows = pages.map((page) =>
  `| ${page.page} | ${page.pageSizeMatch ? 'MATCH' : 'MISMATCH'} | ${(page.pixelSimilarity * 100).toFixed(3)}% | ${(page.inkIoU * 100).toFixed(3)}% | ${(page.structureSimilarity * 100).toFixed(3)}% | ${(page.combined * 100).toFixed(3)}% | ${page.passed ? 'PASS' : 'FAIL'} | ${page.passed ? '—' : page.pageSizeMatch ? 'Visual score below threshold; inspect diff PNG.' : 'MediaBox/page format differs.'} |`,
).join('\n')
const markdown = `# AquaScheme final visual validation\n\nGenerated: ${report.generatedAt}  \nExpected pages: ${expectedPages}  \nThreshold: ${(threshold * 100).toFixed(3)}%  \nAverage: ${(summary.average.combined * 100).toFixed(3)}%  \nWorst: ${(summary.minimum.combined * 100).toFixed(3)}%  \nResult: **${report.passed ? 'PASS' : 'FAIL'}**\n\nThis report covers rendered visual similarity only. Engineering values, source provenance and normative applicability remain independent mandatory gates.\n\n| Page | MediaBox | RGB pixel | Ink IoU | Structure | Overall | Result | Difference reason |\n| ---: | :---: | ---: | ---: | ---: | ---: | :---: | --- |\n${markdownRows}\n`
writeFileSync(markdownPath, markdown, 'utf8')
console.log(`сравнено страниц: ${comparedPages} из ${expectedPages} (эталон ${reference.numPages}, сгенерировано ${generated.numPages})`)
console.log(`average: ${(summary.average.combined * 100).toFixed(3)}%; worst: ${(summary.minimum.combined * 100).toFixed(3)}%`)
console.log(`report: ${reportPath}`)
console.log(`html: ${htmlPath}`)
console.log(`markdown: ${markdownPath}`)
console.log(`diff pages: ${differencePages}`)
process.exit(report.passed ? 0 : 1)

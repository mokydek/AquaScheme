import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractTable } from './pdftable'
import type { TextItem } from './pdftable'
import {
  gridToGeologyRows,
  guessGeologyField,
  parseGeologyRows,
  parseGeologyReportSummary,
} from './geology'

/**
 * Integration probe of the geology PDF pipeline (G2) against the REAL survey
 * report of the benchmark object. The report is confidential and lives only
 * locally (docs/benchmark is gitignored), so the test skips itself honestly
 * when the file is absent (e.g. in CI) and runs the full pdfjs -> table
 * clustering -> field guessing -> borehole parsing chain when present.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REPORT = join(ROOT, 'docs', 'benchmark', 'input', 'geologiya-arh-17-08-25.pdf')
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')

const available = existsSync(REPORT) && existsSync(PDFJS)

describe.skipIf(!available)('geology pipeline on the real survey report', () => {
  it('finds candidate tables and parses boreholes without crashing', async () => {
    const { getDocument } = await import(/* @vite-ignore */ `file://${PDFJS.replace(/\\/g, '/')}`)
    const doc = await getDocument({ url: REPORT, useSystemFonts: true }).promise
    expect(doc.numPages).toBeGreaterThan(10)

    const perPage: Array<{ page: number; rows: number; cols: number; known: number }> = []
    const allRecords: Array<Record<string, string>> = []
    let fullText = ''
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      const items: TextItem[] = (content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
        .filter((it) => typeof it.str === 'string' && Array.isArray(it.transform))
        .map((it) => ({
          str: it.str as string,
          x: (it.transform as number[])[4],
          y: (it.transform as number[])[5],
          width: it.width ?? 0,
          height: it.height && it.height > 0 ? it.height : Math.abs((it.transform as number[])[3]) || 8,
        }))
      page.cleanup()
      if (items.length === 0) continue
      fullText += items.map((it) => it.str).join(' ') + '\n'
      const table = extractTable(items)
      if (table.rows.length < 2 || table.columnCount < 3) continue
      const mapping = Array.from({ length: table.columnCount }, (_, c) => guessGeologyField(table.rows[0][c] ?? ''))
      const known = mapping.filter(Boolean).length
      if (known < 2) continue
      perPage.push({ page: pageNo, rows: table.rows.length, cols: table.columnCount, known })
      allRecords.push(...(gridToGeologyRows(table.rows, mapping, true) as Array<Record<string, string>>))
    }
    await doc.destroy()

    const parsed = parseGeologyRows(allRecords)
    const layers = parsed.boreholes.reduce((s, b) => s + b.layers.length, 0)
    // Honest reporting for the benchmark GAP log.
    console.log(
      `[geology-probe] candidate pages: ${perPage.length}; records: ${allRecords.length}; ` +
        `boreholes: ${parsed.boreholes.length}; layers: ${layers}; row issues: ${parsed.issues.length}`,
    )
    for (const p of perPage.slice(0, 12)) {
      console.log(`[geology-probe] page ${p.page}: ${p.rows}x${p.cols}, known cols ${p.known}`)
    }

    // Real reports keep the ИГЭ list and groundwater in prose (the flat layer
    // table of our template is absent), so the prose parsers are the primary
    // path here; the table path stays for template-shaped reports.
    const summary = parseGeologyReportSummary(fullText)
    const ige = summary.ige
    const water = summary.groundwater
    console.log(`[geology-probe] prose ИГЭ: ${ige.length} (${ige.map((i) => i.code).join(', ')}); water: ${water ? `${water.minDepthM}-${water.maxDepthM} м` : 'не найдена'}`)

    expect(perPage.length + ige.length).toBeGreaterThan(0)
    expect(ige.length).toBeGreaterThanOrEqual(5)
    expect(new Set(ige.map((item) => item.code)).size).toBe(ige.length)
    expect(water).not.toBeNull()
    expect(summary.freezingDepthM).toBeGreaterThanOrEqual(2)
    expect(summary.maxAggressiveness).toBe('high')
    expect(summary.seismicInactive).toBe(true)
  }, 240000)
})

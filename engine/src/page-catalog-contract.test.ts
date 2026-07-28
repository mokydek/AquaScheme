import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type PageType =
  | 'cover'
  | 'general_data'
  | 'plan'
  | 'network_plan'
  | 'longitudinal_profile'
  | 'material_schedule'
  | 'detail'
  | 'specification'

interface CatalogPage {
  pdf_page: number
  drawing_designation: 'R01-MAIN' | 'R01-SPEC' | null
  drawing_sheet: number | null
  drawing_sheet_count: number | null
  page_type: PageType
  title: string
  scale: Record<string, string> | null
  media_box: {
    width_pt: number
    height_pt: number
    width_mm: number
    height_mm: number
    detected_format: string
  }
  rotation_deg: 0 | 270
  display_size_mm: { width: number; height: number }
  display_orientation: 'landscape'
  text_layer: 'extractable' | 'not_detected'
  title_source: string
  title_confidence: 'high' | 'medium' | 'low'
  visual_reviewed: boolean
  observed_components: string[]
  expected_upstream_inputs: string[]
  traceability_status: string
  unresolved: string[]
}

interface PageCatalog {
  schema_version: string
  source: {
    path: 'R01'
    sha256: string
    size_bytes: number
    page_count: number
  }
  pages: CatalogPage[]
}

const catalogUrl = new URL('../../docs/research/page-catalog.json', import.meta.url)
const rawCatalog = readFileSync(catalogUrl, 'utf8')
const catalog = JSON.parse(rawCatalog) as PageCatalog

const allowedTypes = new Set<PageType>([
  'cover',
  'general_data',
  'plan',
  'network_plan',
  'longitudinal_profile',
  'material_schedule',
  'detail',
  'specification',
])

const expectedTypeCounts: Record<PageType, number> = {
  cover: 1,
  general_data: 2,
  plan: 28,
  network_plan: 1,
  longitudinal_profile: 20,
  material_schedule: 5,
  detail: 1,
  specification: 3,
}

describe('reference page catalog contract', () => {
  it('identifies the sanitized immutable 61-page source', () => {
    expect(catalog.source.path).toBe('R01')
    expect(catalog.source.page_count).toBe(61)
    expect(catalog.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(catalog.source.size_bytes).toBeGreaterThan(0)
  })

  it('contains exactly one sequential, unique entry for every PDF page', () => {
    expect(catalog.pages).toHaveLength(61)
    expect(catalog.pages.map((page) => page.pdf_page)).toEqual(
      Array.from({ length: 61 }, (_, index) => index + 1),
    )
    expect(new Set(catalog.pages.map((page) => page.pdf_page)).size).toBe(61)
  })

  it.each(catalog.pages)(
    'page $pdf_page has a complete structural and traceability contract',
    (page) => {
      expect(allowedTypes.has(page.page_type)).toBe(true)
      expect(page.title.trim().length).toBeGreaterThan(0)

      expect(page.media_box.width_pt).toBeGreaterThan(0)
      expect(page.media_box.height_pt).toBeGreaterThan(0)
      expect(page.media_box.width_mm).toBeGreaterThan(0)
      expect(page.media_box.height_mm).toBeGreaterThan(0)
      expect(page.media_box.detected_format.trim().length).toBeGreaterThan(0)
      expect([0, 270]).toContain(page.rotation_deg)
      expect(page.display_orientation).toBe('landscape')
      expect(page.display_size_mm.width).toBeGreaterThan(page.display_size_mm.height)

      const expectedDisplayWidth = page.rotation_deg === 270
        ? page.media_box.height_mm
        : page.media_box.width_mm
      const expectedDisplayHeight = page.rotation_deg === 270
        ? page.media_box.width_mm
        : page.media_box.height_mm
      expect(page.display_size_mm.width).toBeCloseTo(expectedDisplayWidth, 1)
      expect(page.display_size_mm.height).toBeCloseTo(expectedDisplayHeight, 1)

      expect(['extractable', 'not_detected']).toContain(page.text_layer)
      expect(['high', 'medium', 'low']).toContain(page.title_confidence)
      expect(typeof page.visual_reviewed).toBe('boolean')
      expect(page.title_source.trim().length).toBeGreaterThan(0)
      expect(page.observed_components.length).toBeGreaterThan(0)
      expect(page.expected_upstream_inputs.length).toBeGreaterThan(0)
      expect(page.traceability_status.trim().length).toBeGreaterThan(0)
      expect(page.unresolved.length).toBeGreaterThan(0)
      expect(page.unresolved.every((item) => item.trim().length > 0)).toBe(true)

      if (page.pdf_page === 1) {
        expect(page.drawing_designation).toBeNull()
        expect(page.drawing_sheet).toBeNull()
        expect(page.drawing_sheet_count).toBeNull()
      } else if (page.pdf_page <= 58) {
        expect(page.drawing_designation).toBe('R01-MAIN')
        expect(page.drawing_sheet).toBe(page.pdf_page - 1)
        expect(page.drawing_sheet_count).toBe(57)
      } else {
        expect(page.drawing_designation).toBe('R01-SPEC')
        expect(page.drawing_sheet).toBe(page.pdf_page - 58)
        expect(page.drawing_sheet_count).toBe(3)
      }
    },
  )

  it('preserves the observed page-type distribution without encoding route geometry', () => {
    const counts = Object.fromEntries(
      [...allowedTypes].map((type) => [
        type,
        catalog.pages.filter((page) => page.page_type === type).length,
      ]),
    )
    expect(counts).toEqual(expectedTypeCounts)
  })

  it('keeps rotations consistent with the observed sheet families', () => {
    const rotatedPages = catalog.pages.filter((page) => page.rotation_deg === 270)
    expect(rotatedPages).toHaveLength(21)
    expect(rotatedPages.every((page) =>
      page.page_type === 'longitudinal_profile' || page.page_type === 'detail',
    )).toBe(true)
    expect(catalog.pages.filter((page) => page.rotation_deg === 0)).toHaveLength(40)
  })

  it('uses only neutral source and drawing identifiers', () => {
    expect(new Set(catalog.pages.map((page) => page.drawing_designation))).toEqual(
      new Set([null, 'R01-MAIN', 'R01-SPEC']),
    )
    expect(rawCatalog).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(rawCatalog).not.toMatch(/(?:^|["'\s])\/(?:home|Users|mnt|var|tmp)\//m)
    expect(rawCatalog).not.toMatch(/C:\\Users|D:\\/i)
    expect(rawCatalog).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  })
})

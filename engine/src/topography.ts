import type { SurveyPoint } from './types'
import { detectDelimiter, isHeaderLine, parseNumber, splitCsvLines } from './csv'

export type TopoIssueKind = 'missingZ' | 'badNumber' | 'badColumns' | 'invalidFormat'

export interface ParseIssue {
  /** 1 based row or feature number; 0 for file level issues. */
  row: number
  kind: TopoIssueKind
}

export interface TopoParseResult {
  points: SurveyPoint[]
  issues: ParseIssue[]
  /** Number of data rows or features inspected. */
  total: number
}

/**
 * Parse a survey CSV with columns X, Y, Z.
 * Delimiter: comma, semicolon or tab. Decimal comma is accepted.
 * A header row is detected automatically and skipped.
 */
export function parseTopographyCsv(text: string): TopoParseResult {
  const lines = splitCsvLines(text)
  const points: SurveyPoint[] = []
  const issues: ParseIssue[] = []

  if (lines.length === 0) {
    return { points, issues, total: 0 }
  }

  const delimiter = detectDelimiter(lines[0])
  const start = isHeaderLine(lines[0], delimiter) ? 1 : 0

  for (let i = start; i < lines.length; i++) {
    const rowNumber = i + 1
    const cols = lines[i].split(delimiter)
    if (cols.length < 2) {
      issues.push({ row: rowNumber, kind: 'badColumns' })
      continue
    }
    const x = parseNumber(cols[0])
    const y = parseNumber(cols[1])
    if (Number.isNaN(x) || Number.isNaN(y)) {
      issues.push({ row: rowNumber, kind: 'badNumber' })
      continue
    }
    if (cols.length < 3 || cols[2].trim() === '') {
      issues.push({ row: rowNumber, kind: 'missingZ' })
      continue
    }
    const z = parseNumber(cols[2])
    if (Number.isNaN(z)) {
      issues.push({ row: rowNumber, kind: 'missingZ' })
      continue
    }
    points.push({ x, y, z })
  }

  return { points, issues, total: lines.length - start }
}

interface GeoJsonGeometry {
  type?: string
  coordinates?: unknown
}

interface GeoJsonFeature {
  geometry?: GeoJsonGeometry | null
  properties?: Record<string, unknown> | null
}

/**
 * Parse a GeoJSON FeatureCollection of survey points.
 * Elevation is taken from the third coordinate or from the properties
 * z, Z, elev or elevation.
 */
export function parseTopographyGeoJson(text: string): TopoParseResult {
  const points: SurveyPoint[] = []
  const issues: ParseIssue[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { points, issues: [{ row: 0, kind: 'invalidFormat' }], total: 0 }
  }

  const features = (parsed as { features?: unknown }).features
  if (!Array.isArray(features)) {
    return { points, issues: [{ row: 0, kind: 'invalidFormat' }], total: 0 }
  }

  features.forEach((raw, index) => {
    const rowNumber = index + 1
    const feature = raw as GeoJsonFeature
    const geometry = feature.geometry
    if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
      issues.push({ row: rowNumber, kind: 'badColumns' })
      return
    }
    const [xRaw, yRaw, zRaw] = geometry.coordinates as unknown[]
    const x = typeof xRaw === 'number' ? xRaw : Number.NaN
    const y = typeof yRaw === 'number' ? yRaw : Number.NaN
    if (Number.isNaN(x) || Number.isNaN(y)) {
      issues.push({ row: rowNumber, kind: 'badNumber' })
      return
    }
    let z = typeof zRaw === 'number' ? zRaw : Number.NaN
    if (Number.isNaN(z)) {
      const props = feature.properties ?? {}
      for (const key of ['z', 'Z', 'elev', 'elevation']) {
        const candidate = props[key]
        if (typeof candidate === 'number') {
          z = candidate
          break
        }
        if (typeof candidate === 'string' && !Number.isNaN(parseNumber(candidate))) {
          z = parseNumber(candidate)
          break
        }
      }
    }
    if (Number.isNaN(z)) {
      issues.push({ row: rowNumber, kind: 'missingZ' })
      return
    }
    points.push({ x, y, z })
  })

  return { points, issues, total: features.length }
}

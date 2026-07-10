import { detectDelimiter, isHeaderLine, parseNumber, splitCsvLines } from './csv'
import type { ParseIssue } from './topography'

export interface ParsedBuilding {
  x: number
  y: number
  floors: number
  residents: number
  label?: string
}

export interface BuildingsParseResult {
  buildings: ParsedBuilding[]
  issues: ParseIssue[]
  total: number
}

/**
 * Parse a buildings CSV with columns X, Y, floors, residents and an
 * optional label in the fifth column.
 */
export function parseBuildingsCsv(text: string): BuildingsParseResult {
  const lines = splitCsvLines(text)
  const buildings: ParsedBuilding[] = []
  const issues: ParseIssue[] = []

  if (lines.length === 0) {
    return { buildings, issues, total: 0 }
  }

  const delimiter = detectDelimiter(lines[0])
  const start = isHeaderLine(lines[0], delimiter) ? 1 : 0

  for (let i = start; i < lines.length; i++) {
    const rowNumber = i + 1
    const cols = lines[i].split(delimiter)
    if (cols.length < 4) {
      issues.push({ row: rowNumber, kind: 'badColumns' })
      continue
    }
    const x = parseNumber(cols[0])
    const y = parseNumber(cols[1])
    const floors = parseNumber(cols[2])
    const residents = parseNumber(cols[3])
    if ([x, y, floors, residents].some(Number.isNaN)) {
      issues.push({ row: rowNumber, kind: 'badNumber' })
      continue
    }
    if (floors < 1 || !Number.isInteger(floors) || residents < 0) {
      issues.push({ row: rowNumber, kind: 'badNumber' })
      continue
    }
    const label = cols[4]?.trim()
    buildings.push({
      x,
      y,
      floors,
      residents: Math.round(residents),
      ...(label ? { label } : {}),
    })
  }

  return { buildings, issues, total: lines.length - start }
}

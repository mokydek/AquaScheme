import { describe, expect, it } from 'vitest'
import { extractTable, hasTextLayer } from './pdftable'
import type { TextItem } from './pdftable'

/** Build a text item; y grows upward as in PDF user space. */
function cell(str: string, x: number, y: number, width = 20, height = 8): TextItem {
  return { str, x, y, width, height }
}

describe('hasTextLayer', () => {
  it('is false when nothing carries text (a scan)', () => {
    expect(hasTextLayer([cell('', 0, 100), cell('   ', 40, 100)])).toBe(false)
  })
  it('is true when some item has text', () => {
    expect(hasTextLayer([cell('С-1', 0, 100)])).toBe(true)
  })
})

describe('extractTable', () => {
  it('clusters positioned text into a rows by columns grid', () => {
    // Three columns at x = 0, 100, 200; three rows at y = 300, 288, 276.
    const items = [
      cell('Скважина', 0, 300), cell('ИГЭ', 100, 300), cell('Грунт', 200, 300),
      cell('С-1', 0, 288), cell('1', 100, 288), cell('суглинок', 200, 288),
      cell('С-1', 0, 276), cell('2', 100, 276), cell('песок', 200, 276),
    ]
    const table = extractTable(items)
    expect(table.columnCount).toBe(3)
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]).toEqual(['Скважина', 'ИГЭ', 'Грунт'])
    expect(table.rows[1]).toEqual(['С-1', '1', 'суглинок'])
    expect(table.rows[2]).toEqual(['С-1', '2', 'песок'])
  })

  it('joins adjacent runs that share a row and column, in reading order', () => {
    // Two runs of one wrapped cell start close together (within tolerance).
    const items = [
      cell('песок', 200, 288, 30), cell('средний', 208, 288, 40),
      cell('С-1', 0, 288),
    ]
    const table = extractTable(items)
    expect(table.columnCount).toBe(2)
    expect(table.rows[0][0]).toBe('С-1')
    expect(table.rows[0][1]).toBe('песок средний')
  })

  it('tolerates small vertical jitter within a row', () => {
    const items = [
      cell('a', 0, 300), cell('b', 100, 301.5),
      cell('c', 0, 288), cell('d', 100, 287),
    ]
    const table = extractTable(items)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toEqual(['a', 'b'])
  })

  it('returns an empty grid for a scan with no text', () => {
    expect(extractTable([cell('', 0, 100)]).rows).toHaveLength(0)
  })
})

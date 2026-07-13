/**
 * Table extraction from PDF text items (requirements update 3, change 1, G2).
 * Digital PDFs with a text layer expose positioned text runs; this module
 * clusters them into a rows × columns grid with simple, transparent
 * heuristics. It is pure and unit tested; the frontend reads the text items
 * with pdfjs-dist and passes them here.
 *
 * Extraction from PDF is unreliable by nature, so the result is NEVER trusted
 * silently: the UI shows the grid on a mandatory review screen and the data
 * reaches the geology tables only after the user confirms it.
 */

export interface TextItem {
  str: string
  /** Left edge x, PDF user units (origin bottom left). */
  x: number
  /** Baseline y, PDF user units (larger y is higher on the page). */
  y: number
  width: number
  height: number
}

export interface PdfTable {
  /** Grid of trimmed cell strings, top row first. */
  rows: string[][]
  columnCount: number
}

/** True when at least one item carries visible text (else the PDF is a scan). */
export function hasTextLayer(items: TextItem[]): boolean {
  return items.some((it) => it.str.trim() !== '')
}

function medianHeight(items: TextItem[]): number {
  const heights = items.map((it) => it.height).filter((h) => h > 0).sort((a, b) => a - b)
  if (heights.length === 0) return 8
  return heights[Math.floor(heights.length / 2)]
}

/** Group items into visual rows by y proximity, top of page first. */
function groupRows(items: TextItem[], yTolerance: number): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y)
  const rows: TextItem[][] = []
  for (const item of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - item.y) <= yTolerance) row.push(item)
    else rows.push([item])
  }
  return rows
}

/**
 * Derive column boundaries by clustering item left edges across all rows.
 * Two starts within xTolerance belong to the same column. Boundaries are the
 * midpoints between adjacent cluster centers.
 */
function columnCenters(items: TextItem[], xTolerance: number): number[] {
  const xs = items.map((it) => it.x).sort((a, b) => a - b)
  const clusters: Array<{ sum: number; count: number }> = []
  for (const x of xs) {
    const last = clusters[clusters.length - 1]
    if (last && x - last.sum / last.count <= xTolerance) {
      last.sum += x
      last.count++
    } else {
      clusters.push({ sum: x, count: 1 })
    }
  }
  return clusters.map((c) => c.sum / c.count)
}

function assignColumn(x: number, centers: number[]): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(x - centers[i])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

export interface ExtractOptions {
  /** Row grouping tolerance as a fraction of the median text height. */
  yToleranceFactor?: number
  /** Column clustering tolerance in PDF user units. */
  xTolerance?: number
}

/**
 * Cluster positioned text items into a grid. Rows are formed by vertical
 * proximity; columns by horizontal clustering of item left edges. Items that
 * fall in the same row and column are joined with a space (in reading order).
 */
export function extractTable(items: TextItem[], options: ExtractOptions = {}): PdfTable {
  const withText = items.filter((it) => it.str.trim() !== '')
  if (withText.length === 0) return { rows: [], columnCount: 0 }

  const h = medianHeight(withText)
  const yTolerance = h * (options.yToleranceFactor ?? 0.6)
  const xTolerance = options.xTolerance ?? h * 1.5

  const centers = columnCenters(withText, xTolerance)
  const columnCount = centers.length
  const rowGroups = groupRows(withText, yTolerance)

  const rows: string[][] = []
  for (const group of rowGroups) {
    const cells: string[][] = Array.from({ length: columnCount }, () => [])
    for (const item of [...group].sort((a, b) => a.x - b.x)) {
      cells[assignColumn(item.x, centers)].push(item.str.trim())
    }
    const row = cells.map((parts) => parts.join(' ').trim())
    if (row.some((c) => c !== '')) rows.push(row)
  }

  return { rows, columnCount }
}

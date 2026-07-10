/** Shared CSV parsing helpers. */

/** Split raw file text into trimmed, non empty lines. */
export function splitCsvLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Detect the column delimiter of a CSV line: semicolon, tab or comma. */
export function detectDelimiter(line: string): string {
  if (line.includes(';')) return ';'
  if (line.includes('\t')) return '\t'
  return ','
}

/**
 * Parse a numeric cell. Accepts both decimal point and decimal comma
 * (the latter is common in surveying exports).
 */
export function parseNumber(cell: string): number {
  const normalized = cell.trim().replace(',', '.')
  if (normalized === '') return Number.NaN
  return Number(normalized)
}

/** True when the line looks like a header (any cell is not a number). */
export function isHeaderLine(line: string, delimiter: string): boolean {
  return line.split(delimiter).some((cell) => Number.isNaN(parseNumber(cell)))
}

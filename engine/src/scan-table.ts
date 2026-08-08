/**
 * Восстановление таблицы из распознанного скана.
 *
 * Таблица бурового журнала на скане — это не таблица, а россыпь слов с
 * координатами: линеек сетки распознаватель не отдаёт, а межколоночные пробелы
 * в тексте схлопываются до одного. Измерено на синтетическом скане: строка
 * таблицы приходит как «С-1 0.0 1.2 1 Суглинок» — по такому тексту колонки не
 * различить, и разбиение по пробелам дало бы правдоподобную, но выдуманную
 * структуру.
 *
 * Поэтому структура восстанавливается ТОЛЬКО по явным признакам таблицы:
 *
 *   1. Колонка — это вертикальная стопка слов, начинающихся на одной и той же
 *      координате в НЕСКОЛЬКИХ строках. Одиночное совпадение колонкой не
 *      считается: у случайного текста слова тоже иногда встают в столбик.
 *   2. Строка принимает участие, только если число заполненных ячеек у неё
 *      такое же, как у большинства соседних строк.
 *   3. Хотя бы одна колонка должна быть числовой — буровой журнал без чисел
 *      это проза, а не таблица.
 *
 * Строки, не уложившиеся в структуру, НЕ подгоняются и НЕ выбрасываются молча:
 * они возвращаются списком «отброшено» с причиной. Страница, на которой
 * структура не восстановилась, даёт честный отказ, а не таблицу-догадку.
 *
 * Ничего из восстановленного не попадает в проект напрямую: результат идёт на
 * тот же экран сопоставления колонок и обязательной сверки, что и цифровой PDF.
 */

export interface ScanWord {
  text: string
  /** Границы слова по горизонтали, в пикселях отрисованной страницы. */
  x0: number
  x1: number
}

export interface ScanTextLine {
  words: ScanWord[]
}

export interface ScanPageLines {
  page: number
  lines: ScanTextLine[]
}

export type ScanTableRefusal =
  /** Слов с координатами нет: распознавать нечего. */
  | 'noWords'
  /** Вертикальных стопок слов не нашлось: страница не выглядит таблицей. */
  | 'noColumns'
  /** Строк с одинаковым числом ячеек слишком мало для таблицы. */
  | 'noConsistentRows'
  /** Ни одной числовой колонки: это проза, а не буровой журнал. */
  | 'noNumericColumn'

export interface DiscardedScanRow {
  page: number
  text: string
  /** 'cellCount' — иное число ячеек, чем у большинства строк. */
  reason: 'cellCount'
}

export interface RecoveredScanTable {
  rows: string[][]
  columnCount: number
  /** Страница, с которой снята таблица; null при отказе. */
  page: number | null
  discarded: DiscardedScanRow[]
  /** Причина отказа; null, если таблица восстановлена. */
  refusal: ScanTableRefusal | null
}

/** Сколько строк должны разделять координату, чтобы считать её колонкой. */
const MIN_LINES_PER_COLUMN = 3

/** Сколько строк одинаковой ширины нужно, чтобы это была таблица, а не совпадение. */
const MIN_CONSISTENT_ROWS = 3

/** Доля числовых ячеек, при которой колонка считается числовой. */
const NUMERIC_SHARE = 2 / 3

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function isNumeric(cell: string): boolean {
  const cleaned = cell.replace(',', '.').trim()
  return cleaned !== '' && /^-?\d+(\.\d+)?$/.test(cleaned)
}

/**
 * Ширина знака на странице.
 *
 * Допуск выравнивания должен быть в масштабе шрифта, а не в абсолютных
 * пикселях: скан 300 dpi и скан 150 dpi дают вдвое разные координаты одной и
 * той же таблицы.
 */
function charWidth(lines: ScanTextLine[]): number {
  const widths: number[] = []
  for (const line of lines) {
    for (const word of line.words) {
      if (word.text.length > 0 && word.x1 > word.x0) widths.push((word.x1 - word.x0) / word.text.length)
    }
  }
  return median(widths)
}

function recoverPage(page: ScanPageLines): RecoveredScanTable {
  const lines = page.lines.filter((line) => line.words.length > 0)
  const tolerance = charWidth(lines) * 1.5
  if (lines.length === 0 || tolerance <= 0) {
    return { rows: [], columnCount: 0, page: null, discarded: [], refusal: 'noWords' }
  }

  // Стопки слов по левому краю. Слово попадает в стопку, если его левый край
  // отстоит от края стопки меньше, чем на полтора знака.
  const stacks: Array<{ x: number; lines: Set<number> }> = []
  lines.forEach((line, lineIndex) => {
    for (const word of line.words) {
      const stack = stacks.find((item) => Math.abs(item.x - word.x0) <= tolerance)
      if (stack) {
        // Край стопки — самый левый из вошедших: колонка выравнивается по нему.
        stack.x = Math.min(stack.x, word.x0)
        stack.lines.add(lineIndex)
      } else {
        stacks.push({ x: word.x0, lines: new Set([lineIndex]) })
      }
    }
  })

  const columns = stacks
    .filter((stack) => stack.lines.size >= MIN_LINES_PER_COLUMN)
    .map((stack) => stack.x)
    .sort((a, b) => a - b)
  if (columns.length < 2) {
    return { rows: [], columnCount: 0, page: null, discarded: [], refusal: 'noColumns' }
  }

  // Каждое слово — в ближайшую колонку слева. Слова одной колонки склеиваются:
  // «суглинок мягкопластичный» это одна ячейка, а не две.
  const laid = lines.map((line) => {
    const cells: string[] = Array.from({ length: columns.length }, () => '')
    for (const word of line.words) {
      let index = 0
      for (let column = 0; column < columns.length; column++) {
        if (word.x0 + tolerance >= columns[column]) index = column
      }
      cells[index] = cells[index] === '' ? word.text : `${cells[index]} ${word.text}`
    }
    return cells
  })

  // Ширина строки — сколько ячеек заполнено. Ведущей считается та ширина,
  // которая повторяется чаще всего: это и есть «одинаковое число ячеек в
  // соседних строках».
  const filledCount = (cells: string[]) => cells.filter((cell) => cell !== '').length
  const tally = new Map<number, number>()
  for (const cells of laid) {
    const count = filledCount(cells)
    if (count >= 2) tally.set(count, (tally.get(count) ?? 0) + 1)
  }
  let dominant = 0
  let dominantRows = 0
  for (const [count, rows] of tally) {
    if (rows > dominantRows || (rows === dominantRows && count > dominant)) {
      dominant = count
      dominantRows = rows
    }
  }
  if (dominantRows < MIN_CONSISTENT_ROWS) {
    return { rows: [], columnCount: 0, page: null, discarded: [], refusal: 'noConsistentRows' }
  }

  const rows: string[][] = []
  const discarded: DiscardedScanRow[] = []
  laid.forEach((cells, index) => {
    if (filledCount(cells) === dominant) rows.push(cells)
    else {
      discarded.push({
        page: page.page,
        text: lines[index].words.map((word) => word.text).join(' '),
        reason: 'cellCount',
      })
    }
  })

  // Числовая колонка. Заголовок числовым не бывает, поэтому первая строка в
  // счёт не идёт — иначе колонка глубин с подписью «Кровля» не дотягивала бы.
  const body = rows.slice(1)
  const hasNumericColumn = columns.some((_, column) => {
    const values = body.map((cells) => cells[column]).filter((cell) => cell !== '')
    return values.length > 0 && values.filter(isNumeric).length >= values.length * NUMERIC_SHARE
  })
  if (!hasNumericColumn) {
    return { rows: [], columnCount: 0, page: null, discarded: [], refusal: 'noNumericColumn' }
  }

  return { rows, columnCount: columns.length, page: page.page, discarded, refusal: null }
}

/**
 * Снимает таблицу с самой «табличной» страницы скана.
 *
 * Многостраничный отчёт содержит и профили, и прозу: сшивать страницы в одну
 * таблицу нельзя — получится убедительная с виду, но непригодная мешанина. Тот
 * же выбор, что и на цифровом пути.
 */
export function recoverTableFromScan(pages: ScanPageLines[]): RecoveredScanTable {
  const attempts = pages.map(recoverPage)
  const recovered = attempts
    .filter((attempt) => attempt.refusal === null)
    .sort((a, b) => b.rows.length - a.rows.length || b.columnCount - a.columnCount)
  if (recovered.length > 0) return recovered[0]

  // Отказ называется причиной самой «продвинутой» страницы: инженеру полезнее
  // узнать «нет числовой колонки», чем «нет слов» с пустой страницы.
  const order: ScanTableRefusal[] = ['noNumericColumn', 'noConsistentRows', 'noColumns', 'noWords']
  const refusal = order.find((code) => attempts.some((attempt) => attempt.refusal === code)) ?? 'noWords'
  return { rows: [], columnCount: 0, page: null, discarded: [], refusal }
}

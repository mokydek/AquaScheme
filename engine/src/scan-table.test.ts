import { describe, expect, it } from 'vitest'
import { recoverTableFromScan } from './scan-table'
import type { ScanPageLines, ScanTextLine } from './scan-table'

/** Строка скана: слова кладутся на заданные координаты, знак шириной 10 px. */
function line(cells: Array<[string, number]>): ScanTextLine {
  return {
    words: cells.flatMap(([text, x]) => {
      let cursor = x
      return text.split(' ').map((word) => {
        const placed = { text: word, x0: cursor, x1: cursor + word.length * 10 }
        cursor = placed.x1 + 10
        return placed
      })
    }),
  }
}

const COLUMNS = [60, 420, 700, 1000, 1130]
const at = (cells: string[]) => line(cells.map((cell, index) => [cell, COLUMNS[index]] as [string, number]))

const journal: ScanPageLines = {
  page: 1,
  lines: [
    at(['Скважина', 'Кровля', 'Подошва', 'ИГЭ', 'Грунт']),
    at(['С-1', '0.0', '1.2', '1', 'Суглинок']),
    at(['С-1', '1.2', '3.4', '2', 'Песок']),
    at(['С-2', '0.0', '2.0', '1', 'Суглинок']),
    at(['С-2', '2.0', '5.6', '3', 'Глина']),
  ],
}

describe('восстановление таблицы со скана', () => {
  it('выровненные колонки дают таблицу целиком', () => {
    const table = recoverTableFromScan([journal])
    expect(table.refusal).toBeNull()
    expect(table.columnCount).toBe(5)
    expect(table.rows).toHaveLength(5)
    expect(table.rows[1]).toEqual(['С-1', '0.0', '1.2', '1', 'Суглинок'])
    expect(table.discarded).toEqual([])
  })

  it('строка вне структуры отбрасывается и показывается, а не подгоняется', () => {
    const table = recoverTableFromScan([{
      page: 1,
      lines: [...journal.lines, line([['Примечание к таблице', 60]])],
    }])
    expect(table.rows).toHaveLength(5)
    expect(table.discarded).toEqual([
      { page: 1, text: 'Примечание к таблице', reason: 'cellCount' },
    ])
  })

  it('несколько слов одной колонки остаются одной ячейкой', () => {
    const wide: ScanPageLines = {
      page: 1,
      lines: [
        at(['Скважина', 'Кровля', 'Подошва', 'ИГЭ', 'Грунт']),
        at(['С-1', '0.0', '1.2', '1', 'суглинок мягкопластичный']),
        at(['С-1', '1.2', '3.4', '2', 'песок средней крупности']),
        at(['С-2', '0.0', '2.0', '1', 'суглинок тугопластичный']),
      ],
    }
    const table = recoverTableFromScan([wide])
    expect(table.refusal).toBeNull()
    expect(table.rows[1][4]).toBe('суглинок мягкопластичный')
  })

  it('проза не выдаётся за таблицу', () => {
    const prose: ScanPageLines = {
      page: 1,
      lines: [
        line([['Инженерно-геологические условия площадки', 60]]),
        line([['изысканий характеризуются следующим', 95]]),
        line([['По результатам бурения выделено', 70]]),
      ],
    }
    expect(recoverTableFromScan([prose]).refusal).toBe('noColumns')
  })

  it('строки разной ширины таблицей не считаются', () => {
    // Колонки по левому краю есть — а вот повторяющейся ширины строки нет:
    // ни одно число заполненных ячеек не встречается у трёх строк. Такой блок
    // отвергается целиком, а не режется на «похожую на таблицу» часть.
    const ragged: ScanPageLines = {
      page: 1,
      lines: [
        line([['Скважина', 60], ['Кровля', 420], ['Подошва', 700], ['ИГЭ', 1000]]),
        line([['С-1', 60], ['0.0', 420], ['1.2', 700], ['1', 1000]]),
        line([['С-2', 60], ['0.0', 420], ['2.0', 700]]),
        line([['С-3', 60], ['0.0', 420], ['1', 1000]]),
        line([['С-4', 60], ['0.0', 420]]),
      ],
    }
    expect(recoverTableFromScan([ragged]).refusal).toBe('noConsistentRows')
  })

  it('одинокое слово на отшибе колонкой не становится', () => {
    // Сноска у правого края встречается в одной строке из пяти. Колонкой она
    // не считается, и строку из таблицы не выбивает.
    const withNote: ScanPageLines = {
      page: 1,
      lines: journal.lines.map((item, index) => (index === 2
        ? { words: [...item.words, { text: 'сноска', x0: 1400, x1: 1460 }] }
        : item)),
    }
    const table = recoverTableFromScan([withNote])
    expect(table.refusal).toBeNull()
    expect(table.columnCount).toBe(5)
    expect(table.rows).toHaveLength(5)
    // Слово прилипает к последней колонке — и это видно инженеру на сверке,
    // а не растворяется молча.
    expect(table.rows[2][4]).toBe('Песок сноска')
  })

  it('таблица без чисел отвергается: буровой журнал так не выглядит', () => {
    const words: ScanPageLines = {
      page: 1,
      lines: [
        at(['Скважина', 'Грунт', 'Цвет']),
        at(['С-один', 'суглинок', 'бурый']),
        at(['С-два', 'песок', 'жёлтый']),
        at(['С-три', 'глина', 'серый']),
      ],
    }
    expect(recoverTableFromScan([words]).refusal).toBe('noNumericColumn')
  })

  it('страницы не сшиваются: берётся самая табличная', () => {
    const prose: ScanPageLines = {
      page: 1,
      lines: [line([['Пояснительная записка к отчёту', 60]])],
    }
    const table = recoverTableFromScan([prose, { ...journal, page: 7 }])
    expect(table.page).toBe(7)
    expect(table.rows).toHaveLength(5)
  })

  it('отказ называет причину самой продвинутой страницы, а не пустой', () => {
    const empty: ScanPageLines = { page: 1, lines: [] }
    const words: ScanPageLines = {
      page: 2,
      lines: [
        at(['Скважина', 'Грунт', 'Цвет']),
        at(['С-один', 'суглинок', 'бурый']),
        at(['С-два', 'песок', 'жёлтый']),
        at(['С-три', 'глина', 'серый']),
      ],
    }
    expect(recoverTableFromScan([empty, words]).refusal).toBe('noNumericColumn')
  })

  it('масштаб скана значения не имеет: допуск в ширинах знака', () => {
    const doubled: ScanPageLines = {
      page: 1,
      lines: journal.lines.map((item) => ({
        words: item.words.map((word) => ({ ...word, x0: word.x0 * 2, x1: word.x1 * 2 })),
      })),
    }
    const table = recoverTableFromScan([doubled])
    expect(table.refusal).toBeNull()
    expect(table.rows).toHaveLength(5)
  })

  it('лёгкий перекос строки колонку не рушит', () => {
    const skewed: ScanPageLines = {
      page: 1,
      lines: journal.lines.map((item, index) => ({
        words: item.words.map((word) => ({ ...word, x0: word.x0 + index * 4, x1: word.x1 + index * 4 })),
      })),
    }
    const table = recoverTableFromScan([skewed])
    expect(table.refusal).toBeNull()
    expect(table.rows).toHaveLength(5)
  })
})

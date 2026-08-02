import { describe, expect, it } from 'vitest'
import { buildTitleBlock, TITLE_BLOCK_WIDTH_MM } from './titleBlock'

interface Table { table: { widths: number[]; body: Array<Array<Record<string, unknown>>> } }

const base = {
  designation: '2024-51-НК',
  objectName: 'Строительство коллектора',
  sheetTitle: 'План К1 ПК0 - ПК4+33.46. М1:500',
  sheetNumber: 3,
  totalSheets: 7,
  organisation: 'ТОО «Проектировщик»',
}

/** Текст ячейки может лежать и в `text`, и в `stack` — форма 3 использует оба. */
const texts = (node: Table): string[] =>
  node.table.body.flat().flatMap((c) => {
    const stack = (c.stack ?? []) as Array<{ text?: string }>
    return [String(c.text ?? ''), ...stack.map((item) => String(item.text ?? ''))]
  }).filter((t) => t.length > 0)

describe('основная надпись по форме 3', () => {
  it('имеет ширину 185 мм, как задаёт ГОСТ', () => {
    expect(TITLE_BLOCK_WIDTH_MM).toBe(185)
    const node = buildTitleBlock(base) as unknown as Table
    const totalPt = node.table.widths.reduce((sum, w) => sum + w, 0)
    expect(totalPt / (72 / 25.4)).toBeCloseTo(185, 6)
  })

  it('заполняет графы 1, 4, 6, 7, 8 и 9', () => {
    const found = texts(buildTitleBlock(base) as unknown as Table)
    expect(found).toContain('2024-51-НК')                      // графа 1
    expect(found).toContain('План К1 ПК0 - ПК4+33.46. М1:500') // графа 4
    expect(found).toContain('Р')                               // графа 6
    expect(found).toContain('3')                               // графа 7
    expect(found).toContain('7')                               // графа 8
    expect(found).toContain('ТОО «Проектировщик»')             // графа 9
  })

  it('печатает графы 2 и 3: объект и здание, а не только имя листа', () => {
    const found = texts(buildTitleBlock({
      ...base, buildingName: 'Реконструкция сетей водоотведения',
    }) as unknown as Table)
    expect(found).toContain('Строительство коллектора')            // графа 2
    expect(found).toContain('Реконструкция сетей водоотведения')   // графа 3
    expect(found).toContain('План К1 ПК0 - ПК4+33.46. М1:500')     // графа 4
  })

  it('несёт заголовки таблицы изменений, графы 14-19', () => {
    const found = texts(buildTitleBlock(base) as unknown as Table)
    for (const header of ['Изм.', 'Кол.уч.', 'Лист', '№ док.', 'Подп.', 'Дата']) {
      expect(found).toContain(header)
    }
  })

  it('оставляет графу 12 пустой: подпись ставит человек', () => {
    const node = buildTitleBlock({
      ...base,
      signatories: [{ role: 'Разраб.', name: 'Иванов', date: '05.25' }],
    }) as unknown as Table
    const found = texts(node)
    expect(found).toContain('Иванов')
    expect(found).toContain('05.25')
    // Ни одна ячейка не содержит подписи или чего-то похожего на неё.
    expect(found.some((t) => /подпис[ьи]\s*:/i.test(t))).toBe(false)
  })

  it('не выдумывает значения, которых проект не дал', () => {
    const found = texts(buildTitleBlock({
      designation: 'X-1', objectName: 'O', sheetTitle: 'Лист', sheetNumber: 1,
    }) as unknown as Table)
    // Ни организации, ни фамилий, ни общего числа листов.
    expect(found).not.toContain('ТОО «Проектировщик»')
    expect(found.filter((t) => t === 'Разраб.')).toHaveLength(1)
    expect(found).toContain('Р')
  })

  it('стадия задаётся проектом: П для проектной документации', () => {
    const found = texts(buildTitleBlock({ ...base, stage: 'П' }) as unknown as Table)
    expect(found).toContain('П')
  })

  it('всегда рисует четыре строки подписей', () => {
    const node = buildTitleBlock(base) as unknown as Table
    // 2 строки изменений + 4 строки подписей.
    expect(node.table.body).toHaveLength(6)
    expect(node.table.widths).toHaveLength(10)
  })
})

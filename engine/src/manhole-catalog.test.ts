import { describe, expect, it } from 'vitest'
import { parseManholeCatalogRows, selectManholeConstructions } from './manhole-catalog'

describe('parametric manhole catalog', () => {
  it('parses verified source-backed component rules and calculates quantities', () => {
    const parsed = parseManholeCatalogRows([{
      'Тип конструкции': 'K-1',
      'Мин. Ø трубы, мм': 200,
      'Макс. Ø трубы, мм': 800,
      'Мин. глубина, м': 1,
      'Макс. глубина, м': 5,
      'Ø камеры, мм': 1500,
      'Состав (JSON)': '[{"name":"Элемент","unit":"шт","baseQuantity":1,"perMeterQuantity":0.5}]',
      'Источник': 'Каталог, лист 10',
      'Подтверждено': 'да',
    }])
    expect(parsed.issues).toEqual([])
    const selection = selectManholeConstructions([
      { label: 'K-01', picket: 'ПК1', depthMm: 3000, pipeDiameterMm: 600 },
    ], parsed.entries)
    expect(selection.unmatched).toEqual([])
    expect(selection.selected[0].components[0].quantity).toBe(2.5)
  })

  it('does not select an unverified or out-of-range entry', () => {
    const parsed = parseManholeCatalogRows([{
      'Тип конструкции': 'K-1',
      'Мин. Ø трубы, мм': 200,
      'Макс. Ø трубы, мм': 400,
      'Мин. глубина, м': 1,
      'Макс. глубина, м': 2,
      'Ø камеры, мм': 1000,
      'Состав (JSON)': '[{"name":"Элемент","unit":"шт","baseQuantity":1}]',
      'Источник': 'Каталог, лист 1',
      'Подтверждено': 'нет',
    }])
    expect(selectManholeConstructions([
      { label: 'K-02', picket: 'ПК2', depthMm: 2500, pipeDiameterMm: 500 },
    ], parsed.entries).unmatched).toEqual(['K-02'])
  })
})

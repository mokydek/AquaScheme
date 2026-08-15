import { describe, expect, it } from 'vitest'
import { crossConfirm, crossConfirmedValues, quantityValueKey } from './cross-source'
import type { SourceReading } from './cross-source'

const reading = (
  quantity: string, value: number, source: string, quote = `${quantity} = ${value}`,
): SourceReading<number> => ({ quantity, value, source, quote })

describe('перекрёстное подтверждение', () => {
  it('одна величина из двух независимых источников подтверждена', () => {
    const [group] = crossConfirm([
      reading('existingLengthM', 458.94, 'ТУ_05-3-2723'),
      reading('existingLengthM', 458.94, 'ТО_5669'),
    ])
    expect(group.confirmed).toBe(true)
    expect(group.sourceCount).toBe(2)
    expect(group.readings.map((item) => item.source)).toEqual(['ТУ_05-3-2723', 'ТО_5669'])
  })

  it('совпадение чисел у РАЗНЫХ величин подтверждением не является', () => {
    // Ø450 стоит и в ТУ, и в акте, но в ТУ это ПРОЕКТНЫЙ диаметр, а в акте —
    // диаметр СУЩЕСТВУЮЩЕЙ трубы. Совпадение значит «проект сохраняет
    // существующий диаметр», а не «подтверждено двумя источниками», и объявить
    // второе значило бы выдать совпадение за проверку.
    const groups = crossConfirm([
      reading('designDiameterMm', 450, 'ТУ_05-3-2723'),
      reading('existingDiameterMm', 450, 'ТО_5669'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.confirmed)).toBe(false)
    expect(groups.every((group) => group.sourceCount === 1)).toBe(true)
  })

  it('два чтения из одного источника — одно чтение, а не два', () => {
    const [group] = crossConfirm([
      reading('freezingDepthM', 1.71, 'prose', 'для суглинков 1,71 м'),
      reading('freezingDepthM', 1.71, 'prose', 'суглинки — 1,71 м'),
    ])
    expect(group.confirmed).toBe(false)
    expect(group.sourceCount).toBe(1)
    // Обе цитаты всё же сохранены: документ сказал величину в двух местах, и
    // инженеру полезны обе.
    expect(group.readings).toHaveLength(2)
  })

  it('несовпадающие величины остаются несколькими, выбор за инженером', () => {
    const groups = crossConfirm([
      reading('freezingDepthM', 1.71, 'prose'),
      reading('freezingDepthM', 2.08, 'table'),
      reading('freezingDepthM', 2.22, 'table'),
    ])
    expect(groups.map((group) => group.value).sort()).toEqual([1.71, 2.08, 2.22])
    expect(groups.every((group) => group.confirmed)).toBe(false)
  })

  it('подтверждённые идут первыми', () => {
    const groups = crossConfirm([
      reading('freezingDepthM', 2.53, 'table'),
      reading('freezingDepthM', 1.71, 'prose'),
      reading('freezingDepthM', 1.71, 'table'),
    ])
    expect(groups[0].value).toBe(1.71)
    expect(groups[0].confirmed).toBe(true)
  })

  it('происхождение чтения сохраняется: скан отличим от цифрового документа', () => {
    // У ТУ_05-3-2723 текстового слоя нет вовсе, величина прочитана
    // распознаванием, и подтверждение вторым источником этого не отменяет.
    const [group] = crossConfirm([
      { quantity: 'existingLengthM', value: 458.94, source: 'ТУ_05-3-2723', quote: 'L = 458,94 м', origin: 'ocr' },
      { quantity: 'existingLengthM', value: 458.94, source: 'ТО_5669', quote: '458,94 метра', origin: 'stated', page: 10 },
    ])
    expect(group.confirmed).toBe(true)
    expect(group.readings.find((item) => item.source === 'ТУ_05-3-2723')?.origin).toBe('ocr')
  })

  it('набор подтверждённых ключей учитывает и величину, и значение', () => {
    const keys = crossConfirmedValues([
      reading('freezingDepthM', 1.71, 'prose'),
      reading('freezingDepthM', 1.71, 'table'),
      reading('designDiameterMm', 450, 'ТУ'),
    ])
    expect(keys.has(quantityValueKey('freezingDepthM', 1.71))).toBe(true)
    expect(keys.has(quantityValueKey('designDiameterMm', 450))).toBe(false)
  })

  it('ключ строится одной функцией и разделитель в нём виден', () => {
    // Ключ собирался в двух местах шаблонной строкой, и разделитель однажды
    // уехал на невидимый символ: работало, но прочитать было нельзя.
    expect(quantityValueKey('designDiameterMm', 450)).not.toBe(quantityValueKey('designDiameter', 'Mm450'))
    expect(quantityValueKey('freezingDepthM', 1.71)).toBe(quantityValueKey('freezingDepthM', 1.71))
  })

  it('пустой набор чтений даёт пустую сводку', () => {
    expect(crossConfirm([])).toEqual([])
  })
})

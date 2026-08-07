import { describe, expect, it } from 'vitest'
import {
  agreeWithDocument,
  assessExistingSlopes,
  derivePipeLength,
  dominantPipeLabel,
  selfCleaningMinSlope,
} from './existing-condition'
import { extractConditionsFromText } from './norms/conditions-text'
import { sewerChamberDiameterMm } from './norms/sewer'

describe('размер камеры по п. 7.4.2', () => {
  it('мелкая труба даёт колодец 1000 мм', () => {
    expect(sewerChamberDiameterMm(450, 1.5).value).toBe(1000)
  })

  it('глубже 1,8 м колодец не меньше 1500 мм независимо от трубы', () => {
    const size = sewerChamberDiameterMm(450, 3.44)
    expect(size.value).toBe(1500)
    expect(size.note).toContain('свыше 1,8 м')
  })

  it('труба от 700 мм задаёт размер сама', () => {
    expect(sewerChamberDiameterMm(800, 1.2).value).toBe(1200)
  })
})

describe('длина трубы против длины оси', () => {
  it('вычитает камеры: ось минус диаметр на каждый участок', () => {
    // Четыре камеры глубже 1,8 м → по 1500 мм; три участка по 100 м.
    const result = derivePipeLength({
      nodeIds: ['MH-1', 'MH-2', 'MH-3', 'MH-4'],
      depthsM: [3, 3, 3, 3],
      chainageM: [0, 100, 200, 300],
      designDiameterMm: 450,
    })
    expect(result.axisLengthM).toBe(300)
    expect(result.deductionM).toBeCloseTo(4.5, 6)
    expect(result.pipeLengthM).toBeCloseTo(295.5, 6)
    expect(result.reason).toContain('п. 7.4.2')
  })

  it('не вычитает больше самого участка', () => {
    const result = derivePipeLength({
      nodeIds: ['MH-1', 'MH-2'],
      depthsM: [3, 3],
      chainageM: [0, 0.4],
      designDiameterMm: 450,
    })
    expect(result.pipeLengthM).toBe(0)
  })

  it('пустая цепочка не даёт длины и говорит почему', () => {
    const result = derivePipeLength({ nodeIds: [], depthsM: [], chainageM: [], designDiameterMm: 450 })
    expect(result.pipeLengthM).toBe(0)
    expect(result.reason).toContain('цепочка камер пуста')
  })
})

describe('наименьший уклон из самоочищающей скорости', () => {
  it('для DN450 выводится, потому что норма уклон прямо не задаёт', () => {
    const slope = selfCleaningMinSlope(450)
    expect(slope.value).toBeGreaterThan(0.001)
    expect(slope.value).toBeLessThan(0.005)
    expect(slope.note).toContain('м/с')
    expect(slope.refs.length).toBeGreaterThan(0)
  })

  it('чем меньше диаметр, тем круче требуемый уклон', () => {
    expect(selfCleaningMinSlope(200).value).toBeGreaterThan(selfCleaningMinSlope(600).value)
  })
})

describe('оценка существующих уклонов', () => {
  const base = {
    pipeIds: ['P-1', 'P-2'],
    fromNodeIds: ['MH-1', 'MH-2'],
    toNodeIds: ['MH-2', 'MH-3'],
    lengthsM: [100, 100],
    designDiameterMm: 450,
  }

  it('падающий профиль проходит', () => {
    const result = assessExistingSlopes({ ...base, invertsM: [10, 9, 8] })
    expect(result.compliant).toBe(2)
    expect(result.summary).toContain('проходят по уклону')
  })

  it('слишком пологий участок называется числом', () => {
    const result = assessExistingSlopes({ ...base, invertsM: [10, 9.99, 9] })
    expect(result.belowMin).toBe(1)
    expect(result.spans[0].verdict).toBe('below_min')
    expect(result.spans[0].note).toContain('самоочищающая скорость не достигается')
  })

  it('поднявшийся лоток у камеры мельче соседних объясняется врезкой', () => {
    const result = assessExistingSlopes({
      ...base,
      invertsM: [10, 10.5, 9],
      depthsM: [4, 2.5, 4],
    })
    expect(result.counter).toBe(1)
    expect(result.spans[0].note).toContain('врезки')
  })

  it('поднявшийся лоток без такого признака остаётся вопросом к цепочке', () => {
    const result = assessExistingSlopes({
      ...base,
      invertsM: [10, 10.5, 11],
      depthsM: [4, 4.5, 5],
    })
    expect(result.counter).toBe(2)
    expect(result.spans[0].note).toContain('проверить порядок цепочки')
  })
})

describe('преобладающая подпись трубы вдоль трассы', () => {
  const chain = [{ x: 0, y: 0 }, { x: 100, y: 0 }]

  it('одиночная подпись в стороне не перевешивает трассу', () => {
    const label = dominantPipeLabel(chain, [
      { x: 10, y: 1, material: 'керамика', diameterMm: 300 },
      { x: 50, y: 2, material: 'керамика', diameterMm: 300 },
      { x: 90, y: 1, material: 'керамика', diameterMm: 300 },
      { x: 50, y: 3, material: 'чугун', diameterMm: 100 },
    ])
    expect(label).toEqual({ material: 'керамика', diameterMm: 300, count: 3, total: 4 })
  })

  it('подписи вне коридора не учитываются', () => {
    expect(dominantPipeLabel(chain, [{ x: 50, y: 60, material: 'сталь', diameterMm: 100 }])).toBeNull()
  })
})

describe('сходимость чертежа с документом', () => {
  const document = extractConditionsFromText(
    'Керамическая труба Ø450 мм, протяженностью 458,94 метров, без учета врезок. '
    + 'колодцы Ø1,5м – 14 шт. Материал канализационной сети – керамическая труба.',
  )

  it('документ отдаёт и диаметр колодца', () => {
    expect(document.chamberDiameterMm?.value).toBe(1500)
  })

  it('расхождение в пределах процента считается сходимостью', () => {
    const result = agreeWithDocument({
      pipeLengthM: 459,
      chamberCount: 14,
      surveyLabel: { material: 'керамика', diameterMm: 450, count: 14, total: 19 },
      normChamberDiameterMm: 1500,
      document,
    })
    expect(result.agreed).toBe(result.checks.length)
    expect(result.summary).toContain('сходятся по всем')
  })

  it('расхождение больше процента названо числом и процентом', () => {
    const result = agreeWithDocument({
      pipeLengthM: 478.5,
      chamberCount: 14,
      surveyLabel: { material: 'керамика', diameterMm: 450, count: 14, total: 19 },
      normChamberDiameterMm: 1500,
      document,
    })
    const length = result.checks.find((check) => check.quantity.startsWith('Длина'))
    expect(length?.agrees).toBe(false)
    expect(length?.note).toContain('4.3 %')
  })

  it('разные диаметры в чертеже и отчёте показываются весом подписей', () => {
    const result = agreeWithDocument({
      pipeLengthM: 459,
      chamberCount: 14,
      surveyLabel: { material: 'керамика', diameterMm: 300, count: 14, total: 19 },
      normChamberDiameterMm: 1500,
      document,
    })
    const diameter = result.checks.find((check) => check.quantity.startsWith('Диаметр'))
    expect(diameter?.agrees).toBe(false)
    expect(diameter?.note).toContain('14 подписей из 19')
  })

  it('без документа сверять нечего и это сказано прямо', () => {
    const result = agreeWithDocument({
      pipeLengthM: 459,
      chamberCount: 14,
      surveyLabel: null,
      normChamberDiameterMm: null,
      document: extractConditionsFromText('пустой документ'),
    })
    expect(result.checks).toHaveLength(0)
    expect(result.summary).toContain('Сверять не с чем')
  })
})

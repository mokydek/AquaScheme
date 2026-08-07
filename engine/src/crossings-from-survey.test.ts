import { describe, expect, it } from 'vitest'
import { classifyDxfConstraints, type DxfNetworkData } from './dxfread'
import { crossingsFromSurvey } from './crossings-from-survey'

/** Axis runs east along y = 0; utilities cross it north-south. */
const AXIS = [{ x: 0, y: 0 }, { x: 200, y: 0 }]

function survey(
  utilities: Array<[string, number]>,
  labels: Array<[string, number, number, string]> = [],
): DxfNetworkData {
  return {
    ok: true,
    points: [],
    layers: utilities.map(([layer]) => ({ name: layer, segments: 1, points: 0 })),
    segments: utilities.map(([layer, x]) => ({
      layer, points: [{ x, y: -20 }, { x, y: 20 }],
    })),
    textEntities: labels.map(([layer, x, y, text]) => ({ layer, x, y, text })),
  }
}

describe('crossing cards from a survey', () => {
  it('places a card at each intersection with its chainage and family', () => {
    const data = survey([
      ['SIT_LВОДОПРО', 40],
      ['SIT_LТЕПЛОТР', 120],
      ['SIT_LГАЗОПРО', 175],
    ])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data)
    expect(cards.map((c) => [c.kind, c.stationM])).toEqual([
      ['водопровод', 40], ['теплосеть', 120], ['газопровод', 175],
    ])
    expect(cards.every((c) => c.approved === false)).toBe(true)
  })

  it('takes the existing elevation from a levelling label on the same utility', () => {
    const data = survey(
      [['SIT_LТЕПЛОТР', 100]],
      [['NAD_MТЕПЛОТР', 101, 1, '684.30'], ['NAD_MВОДОПРО', 100, 1, '681.10']],
    )
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data)
    expect(cards).toHaveLength(1)
    // The water label is nearer in plan but belongs to another utility.
    expect(cards[0].existingElevationM).toBe(684.30)
  })

  it('computes clearance against the crown, not the invert', () => {
    const data = survey([['SIT_LВОДОПРО', 50]], [['NAD_MВОДОПРО', 50, 1, '685.00']])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data, {
      designInvertAtM: () => 682.2,
      designDiameterMm: 450,
    })
    // 685.00 − (682.20 + 0.45): просвет считается от верха трубы. До правки
    // здесь стояло 2.8 — разность до лотка, завышенная на весь диаметр.
    expect(cards[0].clearanceM).toBeCloseTo(2.35, 3)
    expect(cards[0].designInvertElevationM).toBe(682.2)
  })

  it('leaves the clearance empty when the design bore is unknown', () => {
    const data = survey([['SIT_LВОДОПРО', 50]], [['NAD_MВОДОПРО', 50, 1, '685.00']])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data, {
      designInvertAtM: () => 682.2,
    })
    // Пустая колонка честнее разности до лотка: верх трубы без диаметра неизвестен.
    expect(cards[0].clearanceM).toBeUndefined()
    expect(cards[0].designInvertElevationM).toBe(682.2)
  })

  it('reports a utility passing under the design pipe as a gap below the invert', () => {
    const data = survey([['SIT_LКАНАЛИЗ', 50]], [['NAD_MКАНАЛИЗ', 50, 1, '681.90']])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data, {
      designInvertAtM: () => 682.2,
      designDiameterMm: 450,
    })
    // Сеть ниже лотка: 682.20 − 681.90. Знаковая разность до верха трубы дала бы
    // −0.75 и объявила бы столкновение там, где сеть спокойно проходит снизу.
    expect(cards[0].clearanceM).toBeCloseTo(0.3, 3)
    expect(cards[0].source).toContain('под лотком трубы')
  })

  it('does not turn a multi-stroke symbol into a dozen crossings', () => {
    // The same heat main drawn as five parallel strokes within one metre.
    const data = survey([
      ['SIT_LТЕПЛОТР', 100], ['SIT_LТЕПЛОТР', 100.2], ['SIT_LТЕПЛОТР', 100.4],
      ['SIT_LТЕПЛОТР', 100.6], ['SIT_LТЕПЛОТР', 100.8],
    ])
    expect(crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data)).toHaveLength(1)
  })

  it('leaves the administrative fields empty rather than inventing them', () => {
    const data = survey([['SIT_LВОДОПРО', 60]])
    const [card] = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data)
    expect(card.owner).toBeUndefined()
    expect(card.method).toBeUndefined()
    expect(card.approved).toBe(false)
    expect(card.source).toContain('топосъёмка')
  })

  it('does not report the axis crossing its own main at a chamber', () => {
    // A reconstruction follows the existing sewer, so the line it replaces
    // meets the axis at every chamber; that is topology, not a crossing.
    const data = survey([
      ['SIT_LКАНАЛИЗ', 60],   // the axis's own main, at a chamber
      ['SIT_LВОДОПРО', 120],  // a genuine crossing
    ])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data, {
      ownChamberStationsM: [0, 60, 200],
    })
    expect(cards.map((c) => c.kind)).toEqual(['водопровод'])
  })

  it('keeps a sewer branch that crosses away from any chamber', () => {
    const data = survey([['SIT_LКАНАЛИЗ', 95]])
    const cards = crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data, {
      ownChamberStationsM: [0, 60, 200],
    })
    expect(cards.map((c) => [c.kind, c.stationM])).toEqual([['канализация', 95]])
  })

  it('ignores utilities that do not reach the axis', () => {
    const data: DxfNetworkData = {
      ok: true, points: [],
      layers: [{ name: 'SIT_LВОДОПРО', segments: 1, points: 0 }],
      segments: [{ layer: 'SIT_LВОДОПРО', points: [{ x: 50, y: 30 }, { x: 50, y: 60 }] }],
    }
    expect(crossingsFromSurvey(AXIS, classifyDxfConstraints(data), data)).toEqual([])
  })
})

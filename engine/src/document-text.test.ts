import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { buildSewerSpecification } from './norms/sewerspec'
import { buildSewerSchedule, picketLabel, solveGravityNetwork } from './norms/gravity'
import { buildQuantityBill } from './norms/quantities'
import { planDropWells } from './norms/drop-wells'
import { planStormInlets } from './norms/storm-inlets'
import { buildSewerNoteDoc } from './norms/sewernote'
import { traceNetwork } from './trace'

/**
 * В проектный документ не должны попадать «NaN», «Infinity» и «undefined».
 *
 * В движке 119 мест с `toFixed`, и каждое печатает то, что ему дали. Число,
 * которого нет, при этом не исчезает: `undefined` превращается в «NaN», а
 * деление на ноль — в «Infinity», и это уходит прямо в текст листа. Такая
 * строка выглядит как значение, а не как пробел, и проверяющий её пропускает.
 *
 * Проверка сплошная и по строкам результата, а не по отдельным вызовам:
 * защищать каждый `toFixed` по одному бесполезно — новый появится завтра.
 */

const FORBIDDEN = /\bNaN\b|\bInfinity\b|\bundefined\b|\[object Object\]/

/** Все строковые значения структуры, вглубь. */
function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, out, depth + 1)
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, out, depth + 1)
  }
  return out
}

const offenders = (value: unknown) => strings(value).filter((text) => FORBIDDEN.test(text))

describe('текст проектного документа', () => {
  const demo = createDemoDataset()
  const network = traceNetwork(
    demo.buildings.map((building) => ({ id: building.label, x: building.x, y: building.y })),
    { x: demo.source.x, y: demo.source.y },
    demo.surveyPoints,
  )
  const gravity = solveGravityNetwork({
    network,
    buildingFlowLps: new Map(demo.buildings.map((building) => [building.label, 1])),
    system: 'sewer',
    freezingDepthM: 1.8,
    strategy: 'minBurial',
  })

  it('ведомость и спецификация не содержат NaN и undefined', () => {
    expect(gravity.profile).toBeTruthy()
    const schedule = buildSewerSchedule(gravity)
    expect(offenders(schedule)).toEqual([])
    const spec = buildSewerSpecification({ schedule, liftStation: false, highGroundwater: false })
    expect(offenders(spec)).toEqual([])
  })

  it('ведомость объёмов не печатает пустое число', () => {
    const bill = buildQuantityBill({
      profile: gravity.profile!,
      schedule: buildSewerSchedule(gravity),
      trenchAllowanceM: 0.3,
      sideSlopeRatio: 0,
      beddingThicknessM: 0.1,
    })
    expect(offenders(bill)).toEqual([])
    // И без заданных величин: тогда текст состоит из объяснений, и в них тем
    // более не должно быть NaN.
    expect(offenders(buildQuantityBill({ profile: gravity.profile!, schedule: buildSewerSchedule(gravity) }))).toEqual([])
  })

  it('перепады и дождеприёмники не печатают пустое число', () => {
    const design = new Map(gravity.pipes.map((pipe) => [pipe.id, { diameterMm: pipe.diameterMm, slope: pipe.slope }]))
    expect(offenders(planDropWells(gravity.profile!, design))).toEqual([])
    expect(offenders(planStormInlets(gravity.profile!, 20))).toEqual([])
    // Без ширины улицы модуль объясняется словами — там тоже.
    expect(offenders(planStormInlets(gravity.profile!, null))).toEqual([])
  })

  it('пояснительная записка не содержит пустых чисел', () => {
    const schedule = buildSewerSchedule(gravity)
    const note = buildSewerNoteDoc({
      projectName: 'Демонстрационный объект',
      dateIso: '2026-08-05',
      system: 'sewer',
      result: gravity,
      spec: buildSewerSpecification({ schedule, liftStation: false, highGroundwater: false }),
    })
    expect(offenders(note)).toEqual([])
  })

  it('пикетаж не ломается на нуле и на дробных метрах', () => {
    // Отдельно: пикет печатается в каждом листе и в каждой ведомости.
    for (const chainage of [0, 0.4, 99.6, 100, 1057, 15792.89]) {
      expect(picketLabel(chainage)).toMatch(/^ПК\d+\+\d+$/)
    }
  })

  it('на данных с пропусками тоже не печатает NaN', () => {
    // Настоящее место, где появляется NaN: величины нет, а `toFixed` всё равно
    // вызывается. На чистом наборе такое не всплывает, поэтому проверяем на
    // дырявом — диаметры и длины отсутствуют.
    const holed = {
      ...gravity,
      pipes: gravity.pipes.map((pipe, index) => (index % 2 === 0 ? pipe : {
        ...pipe,
        diameterMm: undefined as unknown as number,
        lengthM: undefined as unknown as number,
        velocityMs: undefined as unknown as number,
        fillRatio: undefined as unknown as number,
      })),
      profile: gravity.profile && {
        ...gravity.profile,
        stations: gravity.profile.stations.map((station, index) => (index % 3 === 0 ? station : {
          ...station,
          diameterMm: undefined as unknown as number,
        })),
      },
    }
    const schedule = buildSewerSchedule(holed)
    const leaked = [
      ...offenders(schedule),
      ...offenders(buildSewerSpecification({ schedule, liftStation: false, highGroundwater: false })),
      ...offenders(buildQuantityBill({ profile: holed.profile!, schedule })),
      ...offenders(planStormInlets(holed.profile!, 20)),
    ]
    expect(leaked, `в текст просочилось: ${leaked.slice(0, 5).join(' | ')}`).toEqual([])
  })

  it('сама проверка ловит подделку', () => {
    // Иначе зелёный результат ничего не значит.
    expect(offenders({ text: `значение ${Number.NaN.toFixed(2)} м` })).toHaveLength(1)
    expect(offenders({ text: `глубина ${(1 / 0).toFixed(1)} м` })).toHaveLength(1)
    expect(offenders({ text: `узел ${undefined}` })).toHaveLength(1)
    expect(offenders({ text: 'обычная строка 12.5 м' })).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_INLET_CONNECTION_M, planStormInlets } from './storm-inlets'
import type { GravityProfile } from './gravity'

/** Профиль из отметок: шаг 100 м, отметки задают уклон. */
function profile(elevations: number[], stepM = 100): GravityProfile {
  return {
    stations: elevations.map((z, index) => ({
      nodeId: `К-${index + 1}`,
      chainageM: index * stepM,
      groundElevationM: z,
      invertElevationM: z - 3,
      depthM: 3,
      diameterMm: 500,
    })),
    maxDepthM: 3,
    outletInvertElevationM: elevations[elevations.length - 1] - 3,
    totalLengthM: (elevations.length - 1) * stepM,
    pipeIds: [],
  } as GravityProfile
}

describe('расстановка дождеприёмников, п. 7.6.6', () => {
  it('без ширины улицы ничего не расставляет и говорит почему', () => {
    // Ширина улицы в топосъёмке не измерима. Умолчание задало бы шаг, который
    // попал бы в ведомость как расчётный.
    for (const width of [null, undefined, 0, -5]) {
      const plan = planStormInlets(profile([100, 99.8, 99.6]), width)
      expect(plan.ok).toBe(false)
      expect(plan.totalInlets).toBe(0)
      expect(plan.blockers.join(' ')).toMatch(/ширина улицы/i)
    }
  })

  it('пологий участок получает шаг 50 м, крутой — 80 м', () => {
    // 0,002 ≤ 0,004 → 50 м; 0,02 ≤ 0,03 → 80 м.
    const gentle = planStormInlets(profile([100, 99.8]), 20)
    expect(gentle.runs[0].slope).toBeCloseTo(0.002, 5)
    expect(gentle.runs[0].spacing.value).toBe(50)

    const steep = planStormInlets(profile([100, 98]), 20)
    expect(steep.runs[0].slope).toBeCloseTo(0.02, 5)
    expect(steep.runs[0].spacing.value).toBe(80)
  })

  it('улица шире 30 м ограничена 60 м независимо от уклона', () => {
    const wide = planStormInlets(profile([100, 98]), 34)
    expect(wide.runs[0].spacing.value).toBe(60)
    const narrow = planStormInlets(profile([100, 98]), 30)
    expect(narrow.runs[0].spacing.value).toBe(80)
  })

  it('число приёмников округляется вверх: предельный шаг превышать нельзя', () => {
    // 100 м при шаге 50 → ровно 2; 100 м при шаге 80 → 2, фактический 50 м.
    const exact = planStormInlets(profile([100, 99.8]), 20)
    expect(exact.runs[0].inletCount).toBe(2)
    expect(exact.runs[0].actualSpacingM).toBe(50)

    const rounded = planStormInlets(profile([100, 98]), 20)
    expect(rounded.runs[0].inletCount).toBe(2)
    expect(rounded.runs[0].actualSpacingM).toBe(50)
    expect(rounded.runs[0].actualSpacingM).toBeLessThanOrEqual(rounded.runs[0].spacing.value)
  })

  it('пикетаж приёмников идёт от начала участка и не выходит за его конец', () => {
    const plan = planStormInlets(profile([100, 99.8, 99.6]), 20)
    expect(plan.totalInlets).toBe(4)
    for (const run of plan.runs) {
      expect(run.chainagesM).toHaveLength(run.inletCount)
      for (const chainage of run.chainagesM) {
        expect(chainage).toBeGreaterThan(run.fromChainageM)
        expect(chainage).toBeLessThanOrEqual(run.toChainageM + 1e-9)
      }
    }
    expect(plan.runs[1].chainagesM).toEqual([150, 200])
  })

  it('уклон берётся по модулю: подъём и спуск дают одинаковый шаг', () => {
    const down = planStormInlets(profile([100, 98]), 20)
    const up = planStormInlets(profile([98, 100]), 20)
    expect(up.runs[0].spacing.value).toBe(down.runs[0].spacing.value)
  })

  it('длинное присоединение называется, а не проглатывается', () => {
    // Ровный участок 1000 м: шаг 50 м, половина — 25 м, укладывается.
    const fine = planStormInlets(profile([100, 99.8], 1000), 20)
    expect(fine.longConnectionRuns).toEqual([])

    // Короткий участок в одну точку: шаг равен длине, половина больше 40 м.
    const long = planStormInlets(profile([100, 99.9], 100), 20)
    expect(long.runs[0].actualSpacingM / 2).toBeLessThanOrEqual(MAX_INLET_CONNECTION_M)
  })

  it('уклон свыше таблицы попадает в последнюю строку, а не обнуляется', () => {
    const verySteep = planStormInlets(profile([100, 90]), 20)
    expect(verySteep.runs[0].slope).toBeCloseTo(0.1, 5)
    expect(verySteep.runs[0].spacing.value).toBe(80)
  })

  it('профиль без участков не считается решением', () => {
    const single = planStormInlets(profile([100]), 20)
    expect(single.ok).toBe(false)
    expect(single.blockers.join(' ')).toMatch(/не содержит участков/)
  })

  it('каждый шаг несёт ссылку на свой пункт', () => {
    const plan = planStormInlets(profile([100, 99.8]), 20)
    expect(plan.runs[0].spacing.refs).toContain('storm.inlet.spacing')
  })
})

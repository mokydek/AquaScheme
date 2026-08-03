import { describe, expect, it } from 'vitest'
import { DROP_EPSILON_M, planDropWells } from './drop-wells'
import type { GravityProfile } from './gravity'

/**
 * Профиль из отметок лотка. Шаг 100 м, диаметр задаётся; уклон участков
 * передаётся отдельной картой, как это делает решатель.
 */
function profile(inverts: number[], diameterMm = 500, stepM = 100): GravityProfile {
  return {
    stations: inverts.map((invert, index) => ({
      nodeId: `К-${index + 1}`,
      chainageM: index * stepM,
      groundElevationM: invert + 3,
      invertElevationM: invert,
      depthM: 3,
      diameterMm,
    })),
    maxDepthM: 3,
    outletInvertElevationM: inverts[inverts.length - 1],
    totalLengthM: (inverts.length - 1) * stepM,
    pipeIds: inverts.slice(1).map((_, index) => `У-${index + 1}`),
  } as GravityProfile
}

const design = (slope: number, count: number, diameterMm = 500) =>
  new Map(Array.from({ length: count }, (_, index) => [`У-${index + 1}`, { diameterMm, slope }]))

describe('перепадные колодцы, п. 7.5.1', () => {
  it('ровное падение по уклону перепадом не считается', () => {
    // Уклон 0,003 на 100 м даёт 0,3 м падения — ступени нет.
    const plan = planDropWells(profile([100, 99.7, 99.4]), design(0.003, 2))
    expect(plan.wells).toEqual([])
    expect(plan.reason).toMatch(/Перепадов на трассе нет/)
  })

  it('падение сверх уклона выделяется как перепад в узле', () => {
    // Второй участок падает на 1,3 м при уклонном падении 0,3 м → ступень 1 м.
    const plan = planDropWells(profile([100, 99.7, 98.4]), design(0.003, 2))
    expect(plan.wells).toHaveLength(1)
    expect(plan.wells[0].nodeId).toBe('К-3')
    expect(plan.wells[0].chainageM).toBe(200)
    expect(plan.wells[0].dropM).toBe(1)
    expect(plan.totalDropM).toBe(1)
  })

  it('до 0,5 м на трубе до 600 мм — слив в смотровом колодце', () => {
    const plan = planDropWells(profile([100, 99.7, 99.2], 500), design(0.003, 2, 500))
    expect(plan.wells[0].dropM).toBe(0.2)
    expect(plan.wells[0].kind.value).toBe('слив в смотровом колодце')
    expect(plan.structureCount).toBe(0)
    expect(plan.wells[0].kind.refs).toContain('sewer.drop.wells')
  })

  it('свыше 0,5 м требует перепадного колодца', () => {
    const plan = planDropWells(profile([100, 99.7, 99.0], 500), design(0.003, 2, 500))
    expect(plan.wells[0].dropM).toBe(0.4)
    expect(plan.wells[0].kind.value).toBe('слив в смотровом колодце')

    const deeper = planDropWells(profile([100, 99.7, 98.9], 500), design(0.003, 2, 500))
    expect(deeper.wells[0].dropM).toBe(0.5)
    expect(deeper.wells[0].kind.value).toBe('слив в смотровом колодце')

    const beyond = planDropWells(profile([100, 99.7, 98.8], 500), design(0.003, 2, 500))
    expect(beyond.wells[0].dropM).toBeCloseTo(0.6, 5)
    expect(beyond.wells[0].kind.value).toBe('перепадный колодец')
    expect(beyond.structureCount).toBe(1)
  })

  it('труба крупнее 600 мм слива не допускает даже при малом перепаде', () => {
    const plan = planDropWells(profile([100, 99.7, 99.2], 800), design(0.003, 2, 800))
    expect(plan.wells[0].dropM).toBe(0.2)
    expect(plan.wells[0].kind.value).toBe('перепадный колодец')
    expect(plan.wells[0].kind.note).toMatch(/предел .*600 мм/)
  })

  it('ровно 600 мм ещё допускает слив: предел включительный', () => {
    const plan = planDropWells(profile([100, 99.7, 99.2], 600), design(0.003, 2, 600))
    expect(plan.wells[0].kind.value).toBe('слив в смотровом колодце')
  })

  it('ступень меньше сантиметра — след округления, а не решение', () => {
    // Без порога перепад находился бы почти на каждом узле.
    const plan = planDropWells(profile([100, 99.7, 99.395]), design(0.003, 2))
    expect(plan.wells).toEqual([])
    expect(DROP_EPSILON_M).toBe(0.01)
  })

  it('подъём лотка перепадом не считается', () => {
    const plan = planDropWells(profile([100, 99.7, 99.9]), design(0.003, 2))
    expect(plan.wells).toEqual([])
  })

  it('без уклона в карте всё падение считается перепадом, а не проглатывается', () => {
    // Участок неизвестен решателю: уклон 0, значит падение целиком ступень.
    const plan = planDropWells(profile([100, 99.4]), new Map())
    expect(plan.wells).toHaveLength(1)
    expect(plan.wells[0].dropM).toBe(0.6)
  })

  it('несколько перепадов складываются и перечисляются пикетами', () => {
    const plan = planDropWells(profile([100, 98.7, 97.4, 97.1]), design(0.003, 3))
    expect(plan.wells).toHaveLength(2)
    expect(plan.totalDropM).toBe(2)
    expect(plan.reason).toMatch(/Пикеты: 100, 200 м/)
  })

  it('профиль без участков не считается решением', () => {
    const single = planDropWells(profile([100]), new Map())
    expect(single.wells).toEqual([])
    expect(single.reason).toMatch(/без участков/)
  })
})

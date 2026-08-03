import { describe, expect, it } from 'vitest'
import { assessGravityFeasibility, planGravityBasins, type GravityProfile } from './norms/gravity'

/** Профиль из станций с равным шагом. */
function profileOf(grounds: number[], stepM = 200): GravityProfile {
  return {
    stations: grounds.map((groundElevationM, index) => ({
      nodeId: `MH-${index + 1}`,
      chainageM: index * stepM,
      groundElevationM,
      invertElevationM: groundElevationM - 3,
      depthM: 3,
      diameterMm: 2000,
    })),
    maxDepthM: 3,
    outletInvertElevationM: grounds[grounds.length - 1] - 3,
    totalLengthM: (grounds.length - 1) * stepM,
    pipeIds: grounds.slice(1).map((_, index) => `P-${index + 1}`),
  }
}

const designOf = (count: number, slope: number) =>
  new Map(Array.from({ length: count }, (_, index) => [`P-${index + 1}`, { diameterMm: 2000, slope }]))

describe('осуществимость самотёка', () => {
  it('крутая местность падение обеспечивает', () => {
    // 10 м падения на 800 м = 12,5 ‰ при потребных 2 ‰.
    const result = assessGravityFeasibility(profileOf([350, 347, 344, 341, 340]), designOf(4, 0.002))
    expect(result.feasible).toBe(true)
    expect(result.availableFallM).toBe(10)
    expect(result.requiredFallM).toBeCloseTo(1.6, 2)
    expect(result.reason).toContain('хватает')
  })

  it('на плоской длинной трассе падения не хватает и это названо', () => {
    // 2,5 м падения на 16 000 м при уклоне 1 ‰: требуется 16 м.
    const grounds = Array.from({ length: 81 }, (_, index) => 345.5 - index * (2.5 / 80))
    const result = assessGravityFeasibility(profileOf(grounds), designOf(80, 0.001))
    expect(result.feasible).toBe(false)
    expect(result.availableFallM).toBeCloseTo(2.5, 2)
    expect(result.requiredFallM).toBeCloseTo(16, 2)
    expect(result.shortfallM).toBeCloseTo(13.5, 2)
    expect(result.terrainSlopePermille).toBeCloseTo(0.16, 2)
    expect(result.designSlopePermille).toBeCloseTo(1, 2)
    expect(result.reason).toContain('не хватает')
    // Средство названо, но выбор оставлен инженеру.
    expect(result.reason).toContain('насосная станция')
    expect(result.reason).toContain('инженер')
  })

  it('подъём местности считается отрицательным падением', () => {
    const result = assessGravityFeasibility(profileOf([340, 341, 342]), designOf(2, 0.001))
    expect(result.availableFallM).toBe(-2)
    expect(result.feasible).toBe(false)
  })

  it('своего предела глубины не вводится', () => {
    // Глубина большая, но падения хватает — это не повод объявлять неосуществимым.
    const deep = profileOf([400, 380, 360, 340])
    deep.maxDepthM = 40
    const result = assessGravityFeasibility(deep, designOf(3, 0.001))
    expect(result.feasible).toBe(true)
    expect(result.maxDepthM).toBe(40)
  })

  it('трасса короче двух станций не оценивается', () => {
    const result = assessGravityFeasibility(profileOf([340]), designOf(0, 0.001))
    expect(result.feasible).toBe(true)
    expect(result.reason).toContain('не оценивается')
  })
})

describe('разбивка на самотёчные бассейны', () => {
  const flat = (count: number, fallM: number) =>
    profileOf(Array.from({ length: count }, (_, index) => 345 - index * (fallM / (count - 1))))

  it('пологая длинная трасса делится, и место перекачки определяет рельеф', () => {
    // 81 станция по 200 м = 16 000 м; падение 2,5 м при уклоне 1 ‰.
    const profile = flat(81, 2.5)
    const design = designOf(80, 0.001)
    const plan = planGravityBasins(profile, design, { maxDepthM: 6, freezingDepthM: 1.8 })
    expect(plan.lifts.length).toBeGreaterThan(1)
    expect(plan.basins).toHaveLength(plan.lifts.length + 1)
    // Ни один бассейн не уходит глубже предела больше чем на один шаг.
    expect(plan.maxDepthM).toBeLessThanOrEqual(6.5)
    expect(plan.reason).toContain('разбита')
    // Перекачки идут по возрастанию пикета: место задаёт трасса.
    const chainages = plan.lifts.map((lift) => lift.chainageM)
    expect([...chainages].sort((a, b) => a - b)).toEqual(chainages)
  })

  it('крутая трасса одним бассейном и обходится', () => {
    const profile = profileOf([350, 347, 344, 341])
    const plan = planGravityBasins(profile, designOf(3, 0.001), { maxDepthM: 6, freezingDepthM: 1.8 })
    expect(plan.lifts).toHaveLength(0)
    expect(plan.basins).toHaveLength(1)
    expect(plan.basins[0].liftAtEnd).toBe(false)
    expect(plan.reason).toContain('одним самотёчным бассейном')
  })

  it('чем мельче предел, тем больше перекачек', () => {
    const profile = flat(41, 1)
    const design = designOf(40, 0.001)
    const deep = planGravityBasins(profile, design, { maxDepthM: 8, freezingDepthM: 1.8 })
    const shallow = planGravityBasins(profile, design, { maxDepthM: 4, freezingDepthM: 1.8 })
    expect(shallow.lifts.length).toBeGreaterThan(deep.lifts.length)
  })

  it('без предела глубины разбивка не выдумывается', () => {
    const plan = planGravityBasins(flat(21, 0.5), designOf(20, 0.001), { maxDepthM: 0, freezingDepthM: 1.8 })
    expect(plan.basins).toHaveLength(0)
    expect(plan.lifts).toHaveLength(0)
    expect(plan.reason).toContain('не выполняется')
  })

  it('высота подъёма — это разница до минимального заглубления', () => {
    const plan = planGravityBasins(flat(81, 2.5), designOf(80, 0.001), { maxDepthM: 6, freezingDepthM: 1.8 })
    for (const lift of plan.lifts) {
      expect(lift.liftHeightM).toBeGreaterThan(0)
      // Подъём не может превышать глубину, с которой поток пришёл.
      expect(lift.liftHeightM).toBeLessThanOrEqual(lift.incomingDepthM)
    }
  })
})

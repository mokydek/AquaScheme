import { describe, expect, it } from 'vitest'
import { assessGravityFeasibility, type GravityProfile } from './norms/gravity'

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

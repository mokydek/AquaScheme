import { describe, expect, it } from 'vitest'
import { assessGeologyInfluences, interpolateGeologyAt, sampleGeoAlong } from './geoprofile'
import type { Borehole } from './geology'

function borehole(label: string, x: number, y: number, over: Partial<Borehole> = {}): Borehole {
  return { label, x, y, layers: [], water: {}, ...over }
}

const B1 = borehole('С-1', 0, 0, {
  layers: [
    { igeCode: '1', soilName: 'суглинок', topDepthM: 0, bottomDepthM: 2.5 },
    { igeCode: '2', soilName: 'песок', topDepthM: 2.5, bottomDepthM: 6 },
  ],
  water: { depthM: 2, aggressivenessSteel: 'high' },
})
const B2 = borehole('С-2', 100, 0, {
  layers: [{ igeCode: '1', soilName: 'глина', topDepthM: 0, bottomDepthM: 5 }],
  water: { depthM: 4, aggressivenessConcrete: 'low' },
})

describe('interpolateGeologyAt', () => {
  it('IDW interpolates the water table between boreholes', () => {
    const mid = interpolateGeologyAt([B1, B2], 50, 0, 2)
    // Equal distance → simple average of 2 and 4.
    expect(mid.waterDepthM).toBeCloseTo(3, 5)
  })

  it('returns the exact value at a borehole', () => {
    expect(interpolateGeologyAt([B1, B2], 0, 0).waterDepthM).toBe(2)
  })

  it('takes the worst aggressiveness among the nearest boreholes', () => {
    expect(interpolateGeologyAt([B1, B2], 10, 0).aggressiveness).toBe('high')
  })

  it('reads the soil at the depth of interest from the nearest borehole', () => {
    expect(interpolateGeologyAt([B1, B2], 5, 0, 3).soilName).toBe('песок')
    expect(interpolateGeologyAt([B1, B2], 5, 0, 1).soilName).toBe('суглинок')
  })

  it('returns nulls without located boreholes', () => {
    const geo = interpolateGeologyAt([borehole('С-1', undefined as unknown as number, 0)], 0, 0)
    expect(geo).toEqual({ waterDepthM: null, aggressiveness: null, soilName: null, igeCode: null })
  })
})

describe('sampleGeoAlong', () => {
  it('assigns cumulative chainage to each vertex', () => {
    const stations = sampleGeoAlong([B1, B2], [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 40 }])
    expect(stations.map((s) => s.stationM)).toEqual([0, 50, 50])
    expect(stations[0].geo.waterDepthM).toBe(2)
  })
})

describe('assessGeologyInfluences', () => {
  it('flags corrosion for aggressive environments and always beds by soil', () => {
    const inf = assessGeologyInfluences({ maxAggressiveness: 'high', minWaterDepthM: 5, burialDepthM: 2.7, dominantSoil: 'песок' })
    const codes = inf.map((i) => i.code)
    expect(codes).toContain('corrosion')
    expect(codes).toContain('bedding')
    expect(codes).not.toContain('dewatering')
    expect(inf.find((i) => i.code === 'corrosion')?.refs).toContain('geology.corrosion')
  })

  it('warns about dewatering when the water table is above the trench bottom', () => {
    const inf = assessGeologyInfluences({ maxAggressiveness: 'low', minWaterDepthM: 1.5, burialDepthM: 2.7 })
    const dew = inf.find((i) => i.code === 'dewatering')
    expect(dew?.severity).toBe('warning')
    expect(dew?.refs).toContain('geology.dewatering')
  })

  it('does not flag corrosion for a low aggressiveness environment', () => {
    const inf = assessGeologyInfluences({ maxAggressiveness: 'low', minWaterDepthM: null, burialDepthM: 2.7 })
    expect(inf.map((i) => i.code)).not.toContain('corrosion')
  })

  it('adds subsidence and heaving measures from the project attributes', () => {
    const inf = assessGeologyInfluences({
      maxAggressiveness: null, minWaterDepthM: null, burialDepthM: 2.7,
      attributes: { subsidenceType: 'II', heaving: true },
    })
    const codes = inf.map((i) => i.code)
    expect(codes).toContain('subsidence')
    expect(codes).toContain('heaving')
  })
})

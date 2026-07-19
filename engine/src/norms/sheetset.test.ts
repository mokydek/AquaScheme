import { describe, expect, it } from 'vitest'
import { paginateByStations, profileSheetSpecs, sliceProfile } from './sheetset'
import type { GravityProfile } from './gravity'

/** Stations every 100 m over 1.6 km (17 manholes). */
const STATIONS = Array.from({ length: 17 }, (_, i) => i * 100)

describe('paginateByStations', () => {
  it('cuts the chainage into sheets snapped to stations', () => {
    const sheets = paginateByStations(STATIONS, 550)
    // Boundaries only on real stations, contiguous, full coverage.
    expect(sheets[0].fromM).toBe(0)
    expect(sheets[sheets.length - 1].toM).toBe(1600)
    for (let i = 1; i < sheets.length; i++) expect(sheets[i].fromM).toBe(sheets[i - 1].toM)
    for (const s of sheets) {
      expect(STATIONS).toContain(s.fromM)
      expect(STATIONS).toContain(s.toM)
      // The tail may be absorbed into the last sheet (< 40% of the target).
      expect(s.toM - s.fromM).toBeLessThanOrEqual(550 * 1.4)
    }
  })

  it('labels bounds with picket notation', () => {
    const sheets = paginateByStations([0, 610.53, 1571.23], 550)
    // 610.53 is beyond the 550 target but is the only reachable station.
    expect(sheets[0].label).toBe('ПК0 - ПК6+10.53')
  })

  it('absorbs a short tail into the last sheet', () => {
    const sheets = paginateByStations([0, 500, 1000, 1100], 500)
    expect(sheets[sheets.length - 1].toM).toBe(1100)
    // No sliver sheet of 100 m: the tail joined the previous interval.
    expect(sheets.every((s) => s.toM - s.fromM >= 100)).toBe(true)
  })

  it('returns nothing for degenerate input', () => {
    expect(paginateByStations([])).toEqual([])
    expect(paginateByStations([5])).toEqual([])
  })
})

function profileOf(stations: number[]): GravityProfile {
  return {
    stations: stations.map((c, i) => ({
      nodeId: `K${i}`,
      chainageM: c,
      groundElevationM: 350 - c * 0.001,
      invertElevationM: 348 - c * 0.002,
      depthM: 2 + c * 0.001,
      diameterMm: 2000,
    })),
    maxDepthM: 2 + stations[stations.length - 1] * 0.001,
    outletInvertElevationM: 348,
    totalLengthM: stations[stations.length - 1],
  }
}

describe('sliceProfile / profileSheetSpecs', () => {
  it('slices stations inclusively and recomputes the fragment depth', () => {
    const slice = sliceProfile(profileOf(STATIONS), 500, 1000)
    expect(slice.stations.map((s) => s.chainageM)).toEqual([500, 600, 700, 800, 900, 1000])
    expect(slice.maxDepthM).toBeCloseTo(3, 5)
    expect(slice.totalLengthM).toBe(500)
  })

  it('produces named К2 sheets covering the whole profile', () => {
    const specs = profileSheetSpecs(profileOf(STATIONS), 'storm', 850)
    expect(specs[0].title).toBe('Профиль К2 ПК0 - ПК8')
    expect(specs[specs.length - 1].interval.toM).toBe(1600)
    // Every fragment keeps at least two stations (both bounds).
    for (const s of specs) expect(s.profile.stations.length).toBeGreaterThanOrEqual(2)
  })
})

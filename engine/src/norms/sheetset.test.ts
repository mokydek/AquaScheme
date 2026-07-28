import { describe, expect, it } from 'vitest'
import { paginateByStations, planWindows, profileSheetSpecs, sliceProfile } from './sheetset'
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
    pipeIds: stations.slice(1).map((_, index) => `P${index}`),
  }
}

describe('planWindows', () => {
  it('windows an L-shaped route with margins and picket labels', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
    ]
    const windows = planWindows(path, 550, 60)
    expect(windows.length).toBeGreaterThanOrEqual(2)
    expect(windows[0].label.startsWith('ПК0 - ')).toBe(true)
    // First window covers the western leg with the margin applied.
    expect(windows[0].minX).toBe(-60)
    expect(windows[0].minY).toBe(-60)
    // Windows are contiguous along the chainage.
    for (let i = 1; i < windows.length; i++) expect(windows[i].fromM).toBe(windows[i - 1].toM)
    // The bend leg appears in the last window's box.
    const last = windows[windows.length - 1]
    expect(last.maxY).toBeGreaterThanOrEqual(500)
  })

  it('returns nothing for a degenerate path', () => {
    expect(planWindows([{ x: 0, y: 0 }])).toEqual([])
  })

  it('uses canonical profile chainage and snaps sheet breaks to supplied nodes, not alignment vertices', () => {
    const path = [
      { x: 0, y: 0, chainageM: 0 },
      { x: 50, y: 0, chainageM: 200 },
      { x: 100, y: 0, chainageM: 500 },
      { x: 150, y: 0, chainageM: 800 },
      { x: 200, y: 0, chainageM: 1200 },
      { x: 250, y: 0, chainageM: 1600 },
    ]
    const nodeChainages = [0, 800, 1600]
    const windows = planWindows(path, 550, 60, nodeChainages)
    expect(windows.map(({ fromM, toM }) => [fromM, toM])).toEqual([[0, 800], [800, 1600]])
    expect(windows.flatMap(({ fromM, toM }) => [fromM, toM]).every((value) => nodeChainages.includes(value))).toBe(true)
  })
})

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

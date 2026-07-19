import { describe, expect, it } from 'vitest'
import { plannedElevationAt, plannedSurfaceAlong } from './vertplan'

const EXISTING = [
  { x: 0, y: 0, z: 340 },
  { x: 100, y: 0, z: 341 },
  { x: 200, y: 0, z: 342 },
]
const DESIGN = [{ x: 100, y: 0, z: 343.5 }]

describe('plannedElevationAt', () => {
  it('uses the design elevation inside its full influence radius', () => {
    const e = plannedElevationAt(100, 0, DESIGN, EXISTING)
    expect(e?.source).toBe('design')
    expect(e?.z).toBe(343.5)
    expect(e?.designWeight).toBe(1)
  })

  it('falls back to the existing terrain beyond the zero influence radius', () => {
    // 150 m from the design point (beyond zeroRadiusM = 120).
    const e = plannedElevationAt(-50, 0, DESIGN, EXISTING)
    expect(e?.source).toBe('existing')
    expect(e?.designWeight).toBe(0)
  })

  it('cross-fades between the surfaces near the influence boundary', () => {
    // 75 m from the design point: halfway between full (30) and zero (120).
    const e = plannedElevationAt(175, 0, DESIGN, EXISTING)
    expect(e?.source).toBe('blend')
    expect(e?.designWeight).toBeGreaterThan(0)
    expect(e?.designWeight).toBeLessThan(1)
    const pureExisting = plannedElevationAt(175, 0, [], EXISTING)
    expect(e?.z).toBeGreaterThan(pureExisting?.z ?? 0) // pulled up toward 343.5
  })

  it('returns null with no data at all', () => {
    expect(plannedElevationAt(0, 0, [], [])).toBeNull()
  })
})

describe('plannedSurfaceAlong', () => {
  it('assigns chainage and blends per vertex', () => {
    const s = plannedSurfaceAlong(
      [{ x: -50, y: 0 }, { x: 100, y: 0 }],
      DESIGN,
      EXISTING,
    )
    expect(s.map((p) => p.stationM)).toEqual([0, 150])
    expect(s[0].elevation?.source).toBe('existing')
    expect(s[1].elevation?.source).toBe('design')
  })
})

import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { minFreeHeadForFloors } from './norms'

describe('createDemoDataset', () => {
  const demo = createDemoDataset()

  it('produces the MVP scale district of 40 buildings', () => {
    expect(demo.buildings).toHaveLength(40)
    expect(demo.buildings.every((b) => b.floors >= 1 && b.floors <= 5)).toBe(true)
    expect(demo.buildings.every((b) => b.residents > 0)).toBe(true)
  })

  it('produces a dense survey grid with sane elevations', () => {
    expect(demo.surveyPoints.length).toBeGreaterThan(300)
    for (const p of demo.surveyPoints) {
      expect(Number.isFinite(p.z)).toBe(true)
      expect(p.z).toBeGreaterThan(90)
      expect(p.z).toBeLessThan(110)
    }
  })

  it('is deterministic', () => {
    const again = createDemoDataset()
    expect(again).toEqual(demo)
  })

  it('places the source at the site with available head', () => {
    expect(demo.source.availableHead).toBe(45)
    expect(Number.isFinite(demo.source.groundElevation)).toBe(true)
  })
})

describe('minFreeHeadForFloors', () => {
  it('follows SNiP 2.04.02 clause 2.26', () => {
    expect(minFreeHeadForFloors(1)).toBe(10)
    expect(minFreeHeadForFloors(5)).toBe(26)
    expect(minFreeHeadForFloors(9)).toBe(42)
  })
})

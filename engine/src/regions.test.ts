import { describe, expect, it } from 'vitest'
import { getRegion, nearestRegion, REGIONS_KZ } from './regions'

describe('REGIONS_KZ', () => {
  it('lists 17 oblasts and 3 cities with unique ids', () => {
    expect(REGIONS_KZ.filter((r) => r.kind === 'oblast')).toHaveLength(17)
    expect(REGIONS_KZ.filter((r) => r.kind === 'city')).toHaveLength(3)
    const ids = REGIONS_KZ.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ships without invented normative values: everything unverified and empty', () => {
    for (const r of REGIONS_KZ) {
      expect(r.status).toBe('unverified')
      expect(r.seismicPoints).toBeNull()
      expect(r.freezingDepthM).toBeNull()
      expect(r.rainParams).toBeNull()
      expect(r.hazards).toHaveLength(0)
    }
  })

  it('finds regions by id', () => {
    expect(getRegion('almaty-city')?.name).toBe('г. Алматы')
    expect(getRegion('missing')).toBeUndefined()
  })
})

describe('nearestRegion', () => {
  it('picks the city whose center is closest to the site', () => {
    expect(nearestRegion(76.9, 43.25)?.id).toBe('almaty-city')
    expect(nearestRegion(71.4, 51.1)?.id).toBe('astana')
    expect(nearestRegion(69.4, 53.3)?.id).toBe('akmola')
  })

  it('returns null for an empty list', () => {
    expect(nearestRegion(70, 50, [])).toBeNull()
  })
})

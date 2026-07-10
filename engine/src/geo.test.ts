import { describe, expect, it } from 'vitest'
import { localToLonLat, lonLatToLocal } from './geo'

describe('local <-> geographic conversion', () => {
  it('round trips within a centimeter', () => {
    const [lon, lat] = localToLonLat(512.34, 287.65)
    const { x, y } = lonLatToLocal(lon, lat)
    expect(x).toBeCloseTo(512.34, 2)
    expect(y).toBeCloseTo(287.65, 2)
  })

  it('maps the origin to the anchor', () => {
    const [lon, lat] = localToLonLat(0, 0)
    expect(lon).toBeCloseTo(71.4, 9)
    expect(lat).toBeCloseTo(51.1, 9)
  })

  it('100 m to the north is about 0.0009 degrees of latitude', () => {
    const [, lat] = localToLonLat(0, 100)
    expect(lat - 51.1).toBeCloseTo(100 / 111320, 9)
  })
})

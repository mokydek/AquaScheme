import { describe, expect, it } from 'vitest'
import {
  analyzeParcelViolations,
  assignBuildingsToParcels,
  pointInPolygon,
  ringFromGeoJsonGeometry,
  segmentCrossesPolygon,
} from './parcels'
import type { ParcelPolygon } from './parcels'

const square = (x0: number, y0: number, size: number) => [
  { x: x0, y: y0 },
  { x: x0 + size, y: y0 },
  { x: x0 + size, y: y0 + size },
  { x: x0, y: y0 + size },
  { x: x0, y: y0 },
]

describe('pointInPolygon', () => {
  it('detects inside and outside', () => {
    const ring = square(0, 0, 100)
    expect(pointInPolygon({ x: 50, y: 50 }, ring)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, ring)).toBe(false)
  })
})

describe('segmentCrossesPolygon', () => {
  it('detects a boundary crossing', () => {
    const ring = square(0, 0, 100)
    expect(segmentCrossesPolygon({ x: -50, y: 50 }, { x: 50, y: 50 }, ring)).toBe(true)
    expect(segmentCrossesPolygon({ x: -50, y: 200 }, { x: 50, y: 200 }, ring)).toBe(false)
  })
})

describe('assignBuildingsToParcels', () => {
  it('assigns each building to the parcel that contains it', () => {
    const parcels: ParcelPolygon[] = [
      { id: 'p1', kind: 'parcel', ring: square(0, 0, 100) },
      { id: 'p2', kind: 'parcel', ring: square(200, 0, 100) },
    ]
    const map = assignBuildingsToParcels(
      [
        { id: 'b1', x: 50, y: 50 },
        { id: 'b2', x: 250, y: 50 },
        { id: 'b3', x: 1000, y: 1000 },
      ],
      parcels,
    )
    expect(map.get('b1')).toBe('p1')
    expect(map.get('b2')).toBe('p2')
    expect(map.has('b3')).toBe(false)
  })
})

describe('analyzeParcelViolations', () => {
  const parcels: ParcelPolygon[] = [
    { id: 'p1', kind: 'parcel', buildingId: 'b1', ring: square(0, 0, 100) },
    { id: 'p2', kind: 'parcel', buildingId: 'b2', ring: square(200, 0, 100) },
    { id: 'row', kind: 'right_of_way', ring: square(-500, 140, 2000) },
  ]

  it('flags a main crossing a foreign parcel', () => {
    const violations = analyzeParcelViolations(
      [{ id: 'M1', kind: 'main', a: { x: 250, y: 50 }, b: { x: 350, y: 50 } }],
      parcels,
    )
    expect(violations).toEqual([{ pipeId: 'M1', parcelId: 'p2' }])
  })

  it('allows a service line into its own parcel and crossing the right of way', () => {
    const violations = analyzeParcelViolations(
      [
        { id: 'S1', kind: 'service', a: { x: 50, y: 150 }, b: { x: 50, y: 50 }, buildingId: 'b1' },
      ],
      parcels,
    )
    expect(violations).toHaveLength(0)
  })
})

describe('ringFromGeoJsonGeometry', () => {
  it('reads a Polygon outer ring', () => {
    const ring = ringFromGeoJsonGeometry({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    })
    expect(ring).toHaveLength(5)
    expect(ring?.[1]).toEqual({ x: 10, y: 0 })
  })

  it('rejects non polygons', () => {
    expect(ringFromGeoJsonGeometry({ type: 'LineString', coordinates: [[0, 0]] })).toBeNull()
  })
})

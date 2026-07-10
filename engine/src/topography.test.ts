import { describe, expect, it } from 'vitest'
import { parseTopographyCsv, parseTopographyGeoJson } from './topography'

describe('parseTopographyCsv', () => {
  it('parses comma separated CSV with a header', () => {
    const result = parseTopographyCsv('x,y,z\n0,0,95.5\n10,0,96.0\n')
    expect(result.points).toEqual([
      { x: 0, y: 0, z: 95.5 },
      { x: 10, y: 0, z: 96 },
    ])
    expect(result.issues).toHaveLength(0)
    expect(result.total).toBe(2)
  })

  it('parses semicolon separated CSV with decimal commas', () => {
    const result = parseTopographyCsv('12,5;30;95,25')
    expect(result.points).toEqual([{ x: 12.5, y: 30, z: 95.25 }])
  })

  it('parses tab separated CSV without a header', () => {
    const result = parseTopographyCsv('100\t200\t97.1')
    expect(result.points).toEqual([{ x: 100, y: 200, z: 97.1 }])
  })

  it('reports rows with a missing Z mark', () => {
    const result = parseTopographyCsv('x,y,z\n0,0,95\n5,5\n6,6,\n7,7,abc')
    expect(result.points).toHaveLength(1)
    const missing = result.issues.filter((i) => i.kind === 'missingZ')
    expect(missing.map((i) => i.row)).toEqual([3, 4, 5])
  })

  it('reports rows with non numeric coordinates', () => {
    const result = parseTopographyCsv('a,b,c\n0,0,95\nfoo,bar,96')
    expect(result.points).toHaveLength(1)
    expect(result.issues).toEqual([{ row: 3, kind: 'badNumber' }])
  })

  it('returns nothing for an empty file', () => {
    const result = parseTopographyCsv('')
    expect(result.points).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})

describe('parseTopographyGeoJson', () => {
  it('takes elevation from the third coordinate', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20, 95.5] }, properties: {} },
      ],
    })
    const result = parseTopographyGeoJson(geojson)
    expect(result.points).toEqual([{ x: 10, y: 20, z: 95.5 }])
  })

  it('falls back to elevation from properties', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { elev: 96.2 } },
      ],
    })
    const result = parseTopographyGeoJson(geojson)
    expect(result.points).toEqual([{ x: 1, y: 2, z: 96.2 }])
  })

  it('reports features without elevation', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
      ],
    })
    const result = parseTopographyGeoJson(geojson)
    expect(result.issues).toEqual([{ row: 1, kind: 'missingZ' }])
  })

  it('rejects invalid JSON', () => {
    const result = parseTopographyGeoJson('not json')
    expect(result.issues).toEqual([{ row: 0, kind: 'invalidFormat' }])
  })
})

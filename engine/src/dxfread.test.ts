import { describe, expect, it } from 'vitest'
import { parseDxfNetwork, parseTopographyDxf } from './dxfread'

const FIXTURE = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '8',
  'NETWORK',
  '10',
  '0.0',
  '20',
  '0.0',
  '11',
  '100.0',
  '21',
  '0.0',
  '0',
  'LWPOLYLINE',
  '8',
  'NETWORK',
  '90',
  '3',
  '10',
  '100.0',
  '20',
  '0.0',
  '10',
  '200.0',
  '20',
  '0.0',
  '10',
  '200.0',
  '20',
  '100.0',
  '0',
  'POINT',
  '8',
  'WELLS',
  '10',
  '0.0',
  '20',
  '0.0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
].join('\r\n')

describe('parseDxfNetwork', () => {
  it('reads lines, polylines and points grouped by layer', () => {
    const data = parseDxfNetwork(FIXTURE)
    expect(data.ok).toBe(true)
    expect(data.segments).toHaveLength(2)
    expect(data.segments[0].layer).toBe('NETWORK')
    expect(data.segments[1].points).toHaveLength(3)
    expect(data.points).toHaveLength(1)
    expect(data.points[0].layer).toBe('WELLS')
    const network = data.layers.find((l) => l.name === 'NETWORK')
    expect(network?.segments).toBe(2)
  })

  it('returns ok false for garbage input', () => {
    expect(parseDxfNetwork('definitely not a dxf').ok).toBe(false)
  })
})

function surveyFixture(zs: Array<number | null>): string {
  const rows: string[] = ['0', 'SECTION', '2', 'ENTITIES']
  zs.forEach((z, i) => {
    rows.push('0', 'POINT', '8', 'SURVEY', '10', String(10 * i), '20', String(20 * i))
    if (z !== null) rows.push('30', String(z))
  })
  rows.push('0', 'ENDSEC', '0', 'EOF')
  return rows.join('\r\n')
}

describe('parseTopographyDxf', () => {
  it('reads survey points with elevations from POINT entities', () => {
    const result = parseTopographyDxf(surveyFixture([351.2, 352.8, 0]))
    expect(result.total).toBe(3)
    expect(result.points).toHaveLength(3)
    expect(result.points[0]).toEqual({ x: 0, y: 0, z: 351.2 })
    expect(result.points[1].z).toBeCloseTo(352.8)
    expect(result.issues).toHaveLength(0)
  })

  it('reports missing elevations when every point sits at zero', () => {
    const result = parseTopographyDxf(surveyFixture([0, 0]))
    expect(result.points).toHaveLength(0)
    expect(result.issues).toHaveLength(2)
    expect(result.issues.every((i) => i.kind === 'missingZ')).toBe(true)
  })

  it('reports invalid format when the drawing has no points', () => {
    const result = parseTopographyDxf('definitely not a dxf')
    expect(result.points).toHaveLength(0)
    expect(result.issues[0]?.kind).toBe('invalidFormat')
  })
})

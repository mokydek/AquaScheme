import { describe, expect, it } from 'vitest'
import { classifyDxfConstraints, parseDxfNetwork, parseTopographyDxf } from './dxfread'

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

  it('preserves the closed flag needed for land-allocation polygons', () => {
    const closed = FIXTURE.replace(
      ['90', '3', '10', '100.0'].join('\r\n'),
      ['90', '3', '70', '1', '10', '100.0'].join('\r\n'),
    )
    const polygon = parseDxfNetwork(closed).segments[1]
    expect(polygon.closed).toBe(true)
    expect(polygon.points[0]).toEqual(polygon.points.at(-1))
  })
})

describe('classifyDxfConstraints', () => {
  it('does not mistake planning and utility layers for designed pipes', () => {
    const data = classifyDxfConstraints({
      ok: true,
      points: [{ x: 2, y: 2, z: 351.2, layer: 'точки' }],
      layers: [
        { name: 'Коридор_инженерных_сетей', segments: 1, points: 0 },
        { name: 'Красные_линии', segments: 1, points: 0 },
        { name: 'Трубопроводы_водоснабжения', segments: 1, points: 0 },
      ],
      segments: [
        { layer: 'Коридор_инженерных_сетей', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] },
        { layer: 'Красные_линии', points: [{ x: 20, y: -10 }, { x: 20, y: 40 }] },
        { layer: 'Трубопроводы_водоснабжения', points: [{ x: 40, y: -10 }, { x: 40, y: 40 }] },
      ],
    })
    expect(data.corridorRings).toHaveLength(1)
    expect(data.redLines).toHaveLength(1)
    expect(data.utilityLines).toHaveLength(1)
    expect(data.surveyPoints).toEqual([{ x: 2, y: 2, z: 351.2 }])
    expect(data.rejectedSurveyPoints).toBe(0)
  })

  it('honours an explicit per-layer role and leaves unknown layers unresolved', () => {
    const source = {
      ok: true,
      points: [],
      layers: [
        { name: 'AXIS-CUSTOM', segments: 1, points: 0 },
        { name: 'MYSTERY', segments: 1, points: 0 },
      ],
      segments: [
        { layer: 'AXIS-CUSTOM', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { layer: 'MYSTERY', points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] },
      ],
    }
    const automatic = classifyDxfConstraints(source)
    expect(automatic.roles.MYSTERY).toBe('unknown')

    const reviewed = classifyDxfConstraints(source, { 'AXIS-CUSTOM': 'guideAxis', MYSTERY: 'ignore' })
    expect(reviewed.guideAxis).toHaveLength(1)
    expect(reviewed.roles.MYSTERY).toBe('ignore')
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
    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toEqual({ x: 0, y: 0, z: 351.2 })
    expect(result.points[1].z).toBeCloseTo(352.8)
    expect(result.issues.some((issue) => issue.kind === 'missingZ')).toBe(true)
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

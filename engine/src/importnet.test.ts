import { describe, expect, it } from 'vitest'
import { importNetwork, parseGeoJsonNetwork } from './importnet'
import { placeFittings } from './equipment'

const SOURCE = { x: -20, y: 0 }

describe('importNetwork', () => {
  it('stitches endpoints within the tolerance into shared nodes', () => {
    const { network, report } = importNetwork(
      [
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { points: [{ x: 100.3, y: 0.2 }, { x: 200, y: 0 }] },
      ],
      [],
      SOURCE,
      [],
    )
    const mains = network.pipes.filter((p) => p.kind === 'main')
    expect(mains).toHaveLength(2)
    expect(network.nodes.filter((n) => n.kind === 'junction')).toHaveLength(3)
    expect(report.snappedVertices).toBeGreaterThanOrEqual(1)
    expect(network.pipes.some((p) => p.kind === 'supply')).toBe(true)
  })

  it('preserves curved source geometry and metadata while reversing and snapping it to graph nodes', () => {
    const { network } = importNetwork(
      [
        {
          points: [{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 100, y: 0 }],
          layer: 'K2-AXIS',
          sourceType: 'LWPOLYLINE',
          sourceHandle: 'A1',
          colorNumber: 5,
          lineType: 'DASHED',
        },
        {
          // Deliberately drawn towards the source. Graph direction reverses it.
          points: [{ x: 200, y: 0 }, { x: 150, y: -25 }, { x: 100.3, y: 0.2 }],
          layer: 'K2-AXIS',
          sourceType: 'LWPOLYLINE',
          sourceHandle: 'A2',
          sourceBlock: 'COLLECTOR',
          sourceInsertHandle: 'I7',
        },
      ],
      [],
      SOURCE,
      [],
      { snapToleranceM: 0.5 },
    )

    const mains = network.pipes.filter((pipe) => pipe.kind === 'main')
    expect(mains).toHaveLength(2)
    expect(mains[0].alignment).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 30 },
      { x: 100, y: 0 },
    ])
    expect(mains[0]).toMatchObject({
      sourceLayer: 'K2-AXIS',
      sourceEntity: 'A1',
      dataSource: 'imported-polyline|type=LWPOLYLINE|layer=K2-AXIS|handle=A1|color=5|linetype=DASHED',
    })
    expect(mains[1].alignment).toEqual([
      { x: 100, y: 0 },
      { x: 150, y: -25 },
      { x: 200, y: 0 },
    ])
    expect(mains[1].dataSource).toBe(
      'imported-polyline|type=LWPOLYLINE|layer=K2-AXIS|handle=A2|block=COLLECTOR|insert=I7',
    )
    const from = network.nodes.find((node) => node.id === mains[1].fromNode)
    const to = network.nodes.find((node) => node.id === mains[1].toNode)
    expect(mains[1].alignment?.[0]).toMatchObject({ x: from?.x, y: from?.y })
    expect(mains[1].alignment?.at(-1)).toMatchObject({ x: to?.x, y: to?.y })
    expect(mains[1].lengthM).toBeCloseTo(111.8, 1)
  })

  it('removes duplicate segments between the same nodes', () => {
    const { report } = importNetwork(
      [
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      ],
      [],
      SOURCE,
      [],
    )
    expect(report.duplicatesRemoved).toBe(1)
    expect(report.pipes).toBe(2) // supply + one main
  })

  it('drops parts not connected to the source and reports them', () => {
    const { network, report } = importNetwork(
      [
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { points: [{ x: 5000, y: 5000 }, { x: 5100, y: 5000 }] },
      ],
      [],
      SOURCE,
      [],
    )
    expect(report.unreachablePipes).toBe(1)
    expect(report.unreachableNodes).toHaveLength(2)
    expect(network.pipes.filter((p) => p.kind === 'main')).toHaveLength(1)
  })

  it('splits a closed polyline into edges preserving the loop', () => {
    const { network } = importNetwork(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            { x: 0, y: 0 },
          ],
        },
      ],
      [],
      SOURCE,
      [],
    )
    const mains = network.pipes.filter((p) => p.kind === 'main')
    expect(mains).toHaveLength(3)
    const total = mains.reduce((s, p) => s + p.lengthM, 0)
    expect(total).toBeCloseTo(400, 1)
  })

  it('attaches buildings with service pipes and counts crossings without nodes', () => {
    const { network, report } = importNetwork(
      [
        { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
        { points: [{ x: 100, y: -50 }, { x: 100, y: 50 }] }, // crosses mid pipe, no shared node
      ],
      [{ id: 'bld-1', x: 50, y: 30 }],
      SOURCE,
      [],
    )
    expect(report.crossingsWithoutNode).toBe(1)
    const service = network.pipes.filter((p) => p.kind === 'service')
    expect(service).toHaveLength(1)
    const buildingNode = network.nodes.find((n) => n.kind === 'building')
    expect(buildingNode?.buildingId).toBe('bld-1')
  })

  it('reports degenerate segments and self intersections', () => {
    const { report } = importNetwork(
      [
        { points: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }] }, // shorter than tolerance
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        {
          points: [
            { x: 200, y: 0 },
            { x: 300, y: 100 },
            { x: 300, y: 0 },
            { x: 200, y: 100 },
          ],
        }, // self crossing zig zag
      ],
      [],
      { x: -20, y: 0 },
      [],
    )
    expect(report.zeroLengthRemoved).toBe(1)
    expect(report.selfIntersections).toBe(1)
  })

  it('is deterministic', () => {
    const segments = [
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] },
    ]
    const a = importNetwork(segments, [], SOURCE, [])
    const b = importNetwork(segments, [], SOURCE, [])
    expect(a).toEqual(b)
  })
})

describe('fittings on an imported graph', () => {
  // A 600 m street drawn as six 100 m sections plus a branch.
  const segments = Array.from({ length: 6 }, (_, i) => ({
    points: [{ x: i * 100, y: 0 }, { x: (i + 1) * 100, y: 0 }],
  }))
  segments.push({ points: [{ x: 300, y: 0 }, { x: 300, y: 120 }] })
  const { network } = importNetwork(segments, [], SOURCE, [])
  const plan = placeFittings(network)

  it('places hydrants with the spacing rule and a valve at branches', () => {
    expect(plan.counts.hydrants).toBeGreaterThanOrEqual(4)
    const valveNodes = new Set(
      plan.items.filter((i) => i.types.includes('valve')).map((i) => i.nodeId),
    )
    const branch = network.nodes.find((n) => n.x === 300 && n.y === 0 && n.kind === 'junction')
    expect(branch).toBeDefined()
    expect(valveNodes.has((branch as { id: string }).id)).toBe(true)
  })

  it('numbers wells at every equipped node and stays deterministic', () => {
    expect(plan.counts.wells).toBe(plan.items.length)
    expect(placeFittings(network)).toEqual(plan)
  })
})

describe('parseGeoJsonNetwork', () => {
  it('reads local meter LineStrings as is', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'route-17',
          properties: { layer: 'NET' },
          geometry: { type: 'LineString', coordinates: [[0, 0], [250, 0]] },
        },
      ],
    })
    const parsed = parseGeoJsonNetwork(text)
    expect(parsed.invalid).toBe(false)
    expect(parsed.treatedAsLonLat).toBe(false)
    expect(parsed.segments[0].points[1].x).toBe(250)
    expect(parsed.segments[0].layer).toBe('NET')
    expect(parsed.segments[0]).toMatchObject({
      sourceType: 'GeoJSON:LineString',
      sourceHandle: 'route-17',
    })
    const imported = importNetwork(parsed.segments, [], SOURCE, []).network.pipes.find((pipe) => pipe.kind === 'main')
    expect(imported?.alignment).toEqual([{ x: 0, y: 0 }, { x: 250, y: 0 }])
    expect(imported?.dataSource).toBe('imported-polyline|type=GeoJSON:LineString|layer=NET|handle=route-17')
  })

  it('detects lon lat coordinates and converts them to local meters', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [71.4, 51.1],
              [71.401, 51.1],
            ],
          },
        },
      ],
    })
    const parsed = parseGeoJsonNetwork(text)
    expect(parsed.treatedAsLonLat).toBe(true)
    const dx = parsed.segments[0].points[1].x - parsed.segments[0].points[0].x
    expect(dx).toBeGreaterThan(60)
    expect(dx).toBeLessThan(80)
  })

  it('rejects files without usable geometry', () => {
    expect(parseGeoJsonNetwork('{"type":"FeatureCollection","features":[]}').invalid).toBe(true)
    expect(parseGeoJsonNetwork('not json').invalid).toBe(true)
  })
})

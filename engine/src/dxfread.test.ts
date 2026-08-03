import { describe, expect, it } from 'vitest'
import {
  classifyDxfConstraints,
  deduplicateImportSegments,
  parseDxfNetwork,
  parseTopographyDxf,
  simplifyDrawingUnderlay,
} from './dxfread'

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

  it('tessellates positive and negative LWPOLYLINE bulges instead of replacing arcs with chords', () => {
    const bulge = Math.tan(Math.PI / 8)
    const fixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '5', 'P', '8', 'BULGE', '90', '2',
      '10', '0', '20', '0', '30', '0', '42', String(bulge), '10', '10', '20', '0', '30', '10',
      '0', 'LWPOLYLINE', '5', 'N', '8', 'BULGE', '90', '2',
      '10', '0', '20', '0', '30', '0', '42', String(-bulge), '10', '10', '20', '0', '30', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const [positive, negative] = parseDxfNetwork(fixture).segments
    expect(positive.points).toHaveLength(46)
    expect(negative.points).toHaveLength(46)
    expect(Math.min(...positive.points.map((point) => point.y))).toBeLessThan(-2)
    expect(Math.max(...negative.points.map((point) => point.y))).toBeGreaterThan(2)
    expect(positive.points[0]).toEqual({ x: 0, y: 0, z: 0 })
    expect(positive.points.at(-1)).toEqual({ x: 10, y: 0, z: 10 })
    expect(positive.points.every((point, index, points) => index === 0 || point.z! >= points[index - 1].z!)).toBe(true)
    expect(positive.sourceHandle).toBe('P')
  })

  it('tessellates bulges in classic POLYLINE entities and preserves closed metadata', () => {
    const fixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'POLYLINE', '5', 'PL', '8', 'BULGE', '70', '1',
      '0', 'VERTEX', '8', 'BULGE', '10', '0', '20', '0', '30', '5', '42', '1',
      '0', 'VERTEX', '8', 'BULGE', '10', '10', '20', '0', '30', '5',
      '0', 'VERTEX', '8', 'BULGE', '10', '10', '20', '10', '30', '5', '42', '-1',
      '0', 'SEQEND',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const segment = parseDxfNetwork(fixture).segments[0]
    expect(segment.sourceType).toBe('POLYLINE')
    expect(segment.closed).toBe(true)
    expect(segment.points.length).toBeGreaterThan(180)
    expect(segment.points[0]).toEqual(segment.points.at(-1))
    expect(segment.points.every((point) => point.z === 5)).toBe(true)
  })

  it('fails a polyline closed when an intermediate vertex is invalid instead of drawing a synthetic chord', () => {
    const fixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '5', 'BROKEN', '8', 'NETWORK', '90', '3',
      '10', '0', '20', '0',
      '10', '5', '20', 'NaN',
      '10', '10', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(fixture)
    expect(data.segments).toHaveLength(0)
    expect(data.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ENTITY_VERTEX_INVALID',
      sourceHandle: 'BROKEN',
      entityType: 'LWPOLYLINE',
      invalidVertexCount: 1,
    }))
    expect(data.ok).toBe(false)
  })

  it('deterministically approximates ARC, CIRCLE and ELLIPSE entities', () => {
    const curveFixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'ARC', '8', 'CURVES', '10', '10', '20', '20', '40', '10', '50', '0', '51', '90',
      '0', 'CIRCLE', '8', 'CURVES', '10', '50', '20', '50', '40', '5',
      '0', 'ELLIPSE', '8', 'CURVES', '10', '100', '20', '100', '11', '20', '21', '0', '40', '0.5', '41', '0', '42', String(Math.PI * 2),
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(curveFixture)
    expect(data.segments).toHaveLength(3)

    const arc = data.segments.find((segment) => segment.sourceType === 'ARC')!
    expect(arc.closed).toBe(false)
    expect(arc.points).toHaveLength(46)
    expect(arc.points[0]).toEqual({ x: 20, y: 20 })
    expect(arc.points.at(-1)?.x).toBeCloseTo(10, 8)
    expect(arc.points.at(-1)?.y).toBeCloseTo(30, 8)

    const circle = data.segments.find((segment) => segment.sourceType === 'CIRCLE')!
    expect(circle.closed).toBe(true)
    expect(circle.points).toHaveLength(181)
    expect(circle.points[0]).toEqual(circle.points.at(-1))

    const ellipse = data.segments.find((segment) => segment.sourceType === 'ELLIPSE')!
    expect(ellipse.closed).toBe(true)
    expect(ellipse.points[0]).toEqual(ellipse.points.at(-1))
    expect(Math.max(...ellipse.points.map((point) => point.x))).toBeCloseTo(120, 8)
    expect(Math.max(...ellipse.points.map((point) => point.y))).toBeCloseTo(110, 8)
  })

  it('approximates a SPLINE from actual fit points and preserves its endpoints', () => {
    const splineFixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'SPLINE', '8', 'CURVES', '70', '0', '71', '3', '74', '3',
      '11', '0', '21', '0', '11', '10', '21', '10', '11', '20', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const spline = parseDxfNetwork(splineFixture).segments[0]
    expect(spline.sourceType).toBe('SPLINE')
    expect(spline.points.length).toBeGreaterThan(20)
    expect(spline.points[0]).toEqual({ x: 0, y: 0 })
    expect(spline.points.at(-1)).toEqual({ x: 20, y: 0 })
    expect(Math.max(...spline.points.map((point) => point.y))).toBeGreaterThan(9)
  })

  it('approximates a SPLINE from control points and valid knots', () => {
    const splineFixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'SPLINE', '8', 'CURVES', '70', '0', '71', '2', '72', '6', '73', '3',
      '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
      '10', '0', '20', '0', '10', '10', '20', '20', '10', '20', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const spline = parseDxfNetwork(splineFixture).segments[0]
    expect(spline.points[0]).toEqual({ x: 0, y: 0 })
    expect(spline.points.at(-1)).toEqual({ x: 20, y: 0 })
    expect(Math.max(...spline.points.map((point) => point.y))).toBeCloseTo(10, 6)
  })

  it('retains DIMENSION text and INSERT metadata without inventing block geometry', () => {
    const annotationFixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'DIMENSION', '5', 'D1', '8', 'DIMS', '10', '0', '20', '0', '11', '5', '21', '3', '42', '12.5', '1', '<>',
      '0', 'INSERT', '5', 'B1', '8', 'SYMBOLS', '2', 'MANHOLE', '10', '40', '20', '50', '30', '351.2',
      '41', '2', '42', '3', '43', '4', '50', '30', '70', '2', '71', '3', '44', '15', '45', '20',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(annotationFixture)
    expect(data.textEntities).toContainEqual(expect.objectContaining({
      x: 5,
      y: 3,
      text: '12.5',
      sourceType: 'DIMENSION',
      sourceHandle: 'D1',
    }))
    expect(data.blockEntities).toContainEqual(expect.objectContaining({
      x: 40,
      y: 50,
      name: 'MANHOLE',
      sourceHandle: 'B1',
      elevation: 351.2,
      rotationDeg: 30,
      scaleX: 2,
      scaleY: 3,
      scaleZ: 4,
      columnCount: 2,
      rowCount: 3,
      columnSpacing: 15,
      rowSpacing: 20,
      definitionAvailable: false,
      expandedSegmentCount: 0,
      expansionDiagnostic: 'BLOCK_DEFINITION_MISSING',
    }))
    expect(data.segments).toHaveLength(0)
    expect(data.diagnostics).toContainEqual(expect.objectContaining({
      code: 'BLOCK_DEFINITION_MISSING',
      blockName: 'MANHOLE',
      sourceHandle: 'B1',
    }))
  })

  it('expands a provided block definition with base point, scale, rotation, translation and Z', () => {
    const fixture = [
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'SYMBOL', '3', 'SYMBOL', '8', '0', '10', '1', '20', '2', '30', '0',
      '0', 'LINE', '5', 'CHILD', '8', '0', '10', '1', '20', '2', '30', '0', '11', '3', '21', '2', '31', '2',
      '0', 'ENDBLK', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '5', 'TOP', '8', 'BLOCK-LAYER', '2', 'SYMBOL', '10', '100', '20', '200', '30', '10',
      '41', '2', '42', '3', '43', '4', '50', '90',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(fixture)
    expect(data.segments).toHaveLength(1)
    expect(data.segments[0]).toEqual(expect.objectContaining({
      layer: 'BLOCK-LAYER',
      sourceType: 'LINE',
      sourceHandle: 'CHILD',
      sourceBlock: 'SYMBOL',
      sourceInsertHandle: 'TOP',
    }))
    expect(data.segments[0].points[0].x).toBeCloseTo(100, 8)
    expect(data.segments[0].points[0].y).toBeCloseTo(200, 8)
    expect(data.segments[0].points[0].z).toBeCloseTo(10, 8)
    expect(data.segments[0].points[1].x).toBeCloseTo(100, 8)
    expect(data.segments[0].points[1].y).toBeCloseTo(204, 8)
    expect(data.segments[0].points[1].z).toBeCloseTo(18, 8)
    expect(data.blockEntities?.[0]).toEqual(expect.objectContaining({
      definitionAvailable: true,
      expandedSegmentCount: 1,
    }))
    expect(data.diagnostics).toEqual([])
  })

  it('stops recursive block expansion and emits an explicit diagnostic', () => {
    const fixture = [
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'LOOP', '3', 'LOOP', '8', '0', '10', '0', '20', '0',
      '0', 'INSERT', '5', 'NESTED', '8', '0', '2', 'LOOP', '10', '0', '20', '0',
      '0', 'ENDBLK', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '5', 'TOP', '8', 'SYMBOLS', '2', 'LOOP', '10', '10', '20', '20',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(fixture)
    expect(data.segments).toHaveLength(0)
    expect(data.diagnostics).toContainEqual(expect.objectContaining({
      code: 'BLOCK_RECURSION_SKIPPED',
      blockName: 'LOOP',
    }))
    expect(data.blockEntities?.[0]).toEqual(expect.objectContaining({
      definitionAvailable: true,
      expandedSegmentCount: 0,
      expansionDiagnostic: 'BLOCK_RECURSION_SKIPPED',
    }))
  })

  it('preserves and transforms nested block annotations and POINT geometry without treating symbols as survey points', () => {
    const fixture = [
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'INNER', '3', 'INNER', '8', '0', '10', '0', '20', '0',
      '0', 'TEXT', '5', 'INNER-T', '8', '0', '10', '1', '20', '0', '40', '0.5', '50', '0', '1', 'nested',
      '0', 'ENDBLK',
      '0', 'BLOCK', '2', 'SYMBOL', '3', 'SYMBOL', '8', '0', '10', '0', '20', '0',
      '0', 'TEXT', '5', 'T', '8', '0', '10', '1', '20', '0', '40', '1', '50', '0', '1', 'plain',
      '0', 'MTEXT', '5', 'MT', '8', '0', '10', '2', '20', '0', '40', '1.5', '50', '0', '1', 'multi',
      '0', 'DIMENSION', '5', 'D', '8', '0', '10', '0', '20', '0', '11', '3', '21', '0',
      '13', '0', '23', '0', '14', '3', '24', '0', '42', '3', '1', '<>',
      '0', 'POINT', '5', 'P', '8', '0', '10', '4', '20', '0', '30', '2',
      '0', 'ATTDEF', '5', 'A', '8', '0', '10', '5', '20', '0', '40', '0.75', '1', 'DEFAULT', '2', 'CODE', '3', 'Code',
      '0', 'INSERT', '5', 'NESTED-I', '8', '0', '2', 'INNER', '10', '6', '20', '0',
      '0', 'ENDBLK', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '5', 'TOP', '8', 'SYMBOLS', '2', 'SYMBOL', '10', '100', '20', '200', '30', '10',
      '41', '2', '42', '2', '43', '3', '50', '90',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(fixture)
    expect(data.segments).toHaveLength(0)
    expect(data.points).toHaveLength(1)
    expect(data.pointEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 208,
      z: 16,
      sourceType: 'POINT',
      sourceHandle: 'P',
      sourceBlock: 'SYMBOL',
      sourceInsertHandle: 'TOP',
    }))
    expect(data.textEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 202,
      text: 'plain',
      sourceType: 'TEXT',
      sourceBlock: 'SYMBOL',
      sourceInsertHandle: 'TOP',
      height: 2,
      rotationDeg: 90,
    }))
    expect(data.textEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 206,
      text: '3',
      sourceType: 'DIMENSION',
      geometryPoints: expect.arrayContaining([
        expect.objectContaining({ x: 100, y: 200 }),
        expect.objectContaining({ x: 100, y: 206 }),
      ]),
    }))
    expect(data.textEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 210,
      text: 'DEFAULT',
      sourceType: 'ATTDEF',
      attributeTag: 'CODE',
      attributePrompt: 'Code',
    }))
    expect(data.textEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 214,
      text: 'nested',
      sourceBlock: 'INNER',
      sourceInsertHandle: 'TOP',
    }))
    expect(data.blockEntities).toContainEqual(expect.objectContaining({
      x: 100,
      y: 212,
      name: 'INNER',
      parentBlock: 'SYMBOL',
      rootInsertHandle: 'TOP',
    }))
    expect(data.diagnostics).toEqual([])
  })

  it('retains attached ATTRIB values that dxf-parser does not expose, without substituting ATTDEF defaults', () => {
    const fixture = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '5', 'I1', '8', 'SYMBOLS', '2', 'WELL', '10', '100', '20', '200', '66', '1',
      '0', 'ATTRIB', '5', 'A1', '8', '0', '10', '101.25', '20', '202.5', '30', '351.7',
      '11', '101.5', '21', '202.75', '31', '351.7', '40', '0.8', '50', '15', '1', 'K-17', '2', 'WELL_ID', '70', '4',
      '0', 'SEQEND',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const attribute = parseDxfNetwork(fixture).textEntities?.find((entity) => entity.sourceType === 'ATTRIB')
    expect(attribute).toEqual(expect.objectContaining({
      x: 101.25,
      y: 202.5,
      z: 351.7,
      text: 'K-17',
      layer: '0',
      sourceHandle: 'A1',
      sourceBlock: 'WELL',
      sourceInsertHandle: 'I1',
      height: 0.8,
      rotationDeg: 15,
      attributeTag: 'WELL_ID',
      attributeVerificationRequired: true,
      geometryPoints: [{ x: 101.5, y: 202.75, z: 351.7 }],
    }))
  })

  it('does not invent a HATCH outline when the parser exposes no boundary paths', () => {
    const hatchOnly = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'HATCH', '8', 'HATCHES', '10', '0', '20', '0', '91', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
    const data = parseDxfNetwork(hatchOnly)
    expect(data.segments).toHaveLength(0)
    expect(data.ok).toBe(false)
  })
})

describe('deduplicateImportSegments', () => {
  it('deduplicates reversed lines and rotated/reversed rings without crossing layer or style boundaries', () => {
    const result = deduplicateImportSegments([
      { layer: 'A|B', lineType: 'DASHED', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] },
      { layer: 'A|B', lineType: 'DASHED', points: [{ x: 10, y: 5 }, { x: 0, y: 0 }] },
      { layer: 'A|B', lineType: 'CONTINUOUS', points: [{ x: 10, y: 5 }, { x: 0, y: 0 }] },
      { layer: 'OTHER', lineType: 'DASHED', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] },
      { layer: 'RING', closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }] },
      { layer: 'RING', closed: true, points: [{ x: 5, y: 5 }, { x: 5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }] },
    ])
    expect(result).toHaveLength(4)
    expect(result.map((segment) => segment.layer)).toEqual(['A|B', 'A|B', 'OTHER', 'RING'])
  })

  it('includes Z in the geometry key while still deduplicating a reversed 3D segment', () => {
    const result = deduplicateImportSegments([
      { layer: '3D', points: [{ x: 0, y: 0, z: 350 }, { x: 10, y: 0, z: 351 }] },
      { layer: '3D', points: [{ x: 10, y: 0, z: 351 }, { x: 0, y: 0, z: 350 }] },
      { layer: '3D', points: [{ x: 0, y: 0, z: 349 }, { x: 10, y: 0, z: 350 }] },
      { layer: '3D', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ])
    expect(result).toHaveLength(3)
    expect(result.map((segment) => segment.points[0].z)).toEqual([350, 349, undefined])
  })

  it('схлопывает любой поворот кольца, а не только записанный первым', () => {
    // Канонический вид ищется наименьшим поворотом, а не перебором всех 2n
    // копий кольца: перебор был квадратичным и стоил 3,3 с на классификацию
    // топоосновы, полной развёрнутых в кольца окружностей.
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const rotations = ring.map((_, index) => ({
      layer: 'RING',
      closed: true,
      points: [...ring.slice(index), ...ring.slice(0, index)],
    }))
    const reversed = rotations.map((segment) => ({
      ...segment,
      points: [...segment.points].reverse(),
    }))
    expect(deduplicateImportSegments([...rotations, ...reversed])).toHaveLength(1)
  })

  it('одинаковые вершины в кольце не схлопывают разные кольца', () => {
    // Вырожденный случай: наименьшая вершина встречается дважды, поэтому
    // кандидатов на поворот несколько и выбрать надо действительно меньший.
    const P = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
    const a = [P[0], P[1], P[0], P[2], P[3]]
    // Тот же обход, начатый с другой вершины.
    const b = [P[0], P[2], P[0], P[1], P[3]]
    const result = deduplicateImportSegments([
      { layer: 'RING', closed: true, points: a },
      // Поворот того же кольца — обязан схлопнуться.
      { layer: 'RING', closed: true, points: [...a.slice(2), ...a.slice(0, 2)] },
      // Другой обход тех же вершин — поворотом не является, обязан остаться.
      { layer: 'RING', closed: true, points: b },
    ])
    expect(result).toHaveLength(2)
  })

  it('кольцо из совпадающих вершин не зацикливает поиск', () => {
    const same = Array.from({ length: 40 }, () => ({ x: 3, y: 4 }))
    expect(deduplicateImportSegments([
      { layer: 'DEGENERATE', closed: true, points: same },
      { layer: 'DEGENERATE', closed: true, points: same },
    ])).toHaveLength(1)
  })
})

describe('simplifyDrawingUnderlay', () => {
  it('убирает вершины, неразличимые на чертеже, и оставляет форму', () => {
    // Прямая с миллиметровым дрожанием, каким CAD хранит оцифрованную линию.
    const noisy = Array.from({ length: 50 }, (_, i) => ({
      x: i, y: (i % 2 === 0 ? 0.004 : -0.004) + 1e-9 * i,
    }))
    const [result] = simplifyDrawingUnderlay([{ layer: 'CTX', points: noisy }])
    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toEqual({ x: 0, y: 0.004 })
    expect(result.points[1]).toEqual({ x: 49, y: -0.004 })
  })

  it('излом крупнее допуска сохраняется', () => {
    const bend = [{ x: 0, y: 0 }, { x: 10, y: 0.5 }, { x: 20, y: 0 }]
    const [result] = simplifyDrawingUnderlay([{ layer: 'CTX', points: bend }])
    expect(result.points).toHaveLength(3)
  })

  it('координаты округляются до миллиметра', () => {
    const [result] = simplifyDrawingUnderlay([{
      layer: 'CTX',
      points: [{ x: -232.41823975000001, y: 8117.000499999999 }, { x: 100.7654321, y: 0 }],
    }])
    expect(result.points[0]).toEqual({ x: -232.418, y: 8117 })
    expect(result.points[1]).toEqual({ x: 100.765, y: 0 })
  })

  it('отметка вершины сохраняется, когда она есть', () => {
    const [result] = simplifyDrawingUnderlay([{
      layer: 'CTX',
      points: [{ x: 0, y: 0, z: 345.5534 }, { x: 50, y: 0, z: 346.1119 }],
    }])
    expect(result.points[0].z).toBe(345.553)
    expect(result.points[1].z).toBe(346.112)
  })

  it('слой и стиль линии не теряются', () => {
    const [result] = simplifyDrawingUnderlay([{
      layer: 'SIT_LВОДОПРО',
      lineType: 'DASHED',
      colorNumber: 5,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    }])
    expect(result.layer).toBe('SIT_LВОДОПРО')
    expect(result.lineType).toBe('DASHED')
    expect(result.colorNumber).toBe(5)
  })

  it('допуск можно задать явно', () => {
    const bend = [{ x: 0, y: 0 }, { x: 10, y: 0.5 }, { x: 20, y: 0 }]
    expect(simplifyDrawingUnderlay([{ layer: 'CTX', points: bend }], 1)[0].points).toHaveLength(2)
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

  it('routes cable and gas ducts as utilities instead of hydrography', () => {
    // Real master-plan layer names spell utility ducts as «каналы», which must
    // not be read as a watercourse: that would demand an approved water
    // crossing over a power duct and skip the utility clearance checks.
    const ductLayers = ['Кабельные_каналы_эл', 'кабельные_каналы_ГУВД', 'каналы_газоснабжения']
    const chamberLayer = 'Камеры_кабельных_каналов_сетей_электроснабжения'
    const all = [...ductLayers, chamberLayer, 'гидрография']
    const data = classifyDxfConstraints({
      ok: true,
      points: [],
      layers: all.map((name) => ({ name, segments: 1, points: 0 })),
      segments: all.map((layer, index) => ({
        layer,
        points: [{ x: 0, y: index * 10 }, { x: 100, y: index * 10 }],
      })),
    })
    for (const layer of ductLayers) expect(data.roles[layer]).toBe('utility')
    // Chambers stay structures — the earlier «камеры» rule owns that decision.
    expect(data.roles[chamberLayer]).toBe('structure')
    expect(all.filter((layer) => data.roles[layer] === 'hydrography')).toEqual(['гидрография'])
    expect(data.utilityLines).toHaveLength(ductLayers.length)
    expect(data.hydrography).toHaveLength(1)
  })

  it('classifies utilities whose layer names are truncated by the source CAD', () => {
    // Municipal bases still ship 10-character layer names.
    const truncated: Array<[string, string]> = [
      ['SIT_LВОДОПРО', 'utility'],
      ['SIT_LГАЗОПРО', 'utility'],
      ['SIT_LТЕПЛОТР', 'utility'],
      ['SIT_LЛЭП', 'utility'],
      ['SIT_LЛИН_СВЯ', 'utility'],
      ['SIT_LКАНАЛИЗ', 'utility'],
      ['SIT_LГИДРОГР', 'hydrography'],
      ['NAD_MУЛИЦЫ', 'road'],
      ['SIT_LЗДАНИЯ', 'building'],
    ]
    const data = classifyDxfConstraints({
      ok: true,
      points: [],
      layers: truncated.map(([name]) => ({ name, segments: 1, points: 0 })),
      segments: truncated.map(([layer], index) => ({
        layer,
        points: [{ x: 0, y: index * 10 }, { x: 100, y: index * 10 }],
      })),
    })
    for (const [layer, role] of truncated) expect(data.roles[layer], layer).toBe(role)
  })

  it('derives survey points from spot-height labels when the drawing carries no Z', () => {
    const data = classifyDxfConstraints({
      ok: true,
      points: [{ x: 1, y: 1, layer: 'РЕЛЬЕФ' }],
      layers: [
        { name: 'РЕЛЬЕФ', segments: 0, points: 1 },
        { name: 'SIT_LТЕПЛОТР', segments: 1, points: 0 },
      ],
      segments: [{ layer: 'SIT_LТЕПЛОТР', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }],
      textEntities: [
        { x: 10, y: 20, text: '686.86', layer: 'РЕЛЬЕФ' },
        { x: 30, y: 25, text: '687,11', layer: 'РЕЛЬЕФ' },
        { x: 50, y: 30, text: '12', layer: 'РЕЛЬЕФ' },          // point number, not a height
        { x: 70, y: 35, text: 'К-1', layer: 'РЕЛЬЕФ' },
        { x: 90, y: 40, text: '681.20', layer: 'SIT_LТЕПЛОТР' }, // heat-main invert, not ground
      ],
    })
    expect(data.surveyPointSource).toBe('elevation_labels')
    expect(data.surveyPoints).toEqual([{ x: 10, y: 20, z: 686.86 }, { x: 30, y: 25, z: 687.11 }])
  })

  it('prefers real Z geometry over labels and reports the source', () => {
    const data = classifyDxfConstraints({
      ok: true,
      points: [{ x: 2, y: 2, z: 351.2, layer: 'РЕЛЬЕФ' }],
      layers: [{ name: 'РЕЛЬЕФ', segments: 0, points: 1 }],
      segments: [],
      textEntities: [{ x: 10, y: 20, text: '686.86', layer: 'РЕЛЬЕФ' }],
    })
    expect(data.surveyPointSource).toBe('geometry')
    expect(data.surveyPoints).toEqual([{ x: 2, y: 2, z: 351.2 }])
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

  it('deduplicates repeated context and terrain linework used by the drawing underlay', () => {
    const line = { layer: 'TOPO', points: [{ x: 0, y: 0 }, { x: 100, y: 5 }] }
    const data = classifyDxfConstraints({
      ok: true,
      points: [],
      layers: [{ name: 'TOPO', segments: 2, points: 0 }],
      segments: [line, { ...line, points: [...line.points].reverse() }],
    }, { TOPO: 'terrain' })
    expect(data.contextLines).toHaveLength(1)
    expect(data.terrainLines).toHaveLength(1)
  })

  it('опознаёт сети и красные линии по именам реальной топоосновы', () => {
    // Все названия взяты со съёмки Талдыколя, включая описку в «лииний».
    const names = [
      'Люк_сетей_водоснабжения',
      'Колодцы_системы_водоотведения',
      '_центрального_водоснабжен',
      'Рабочий_слой_крассных_лииний',
      'Понизительные_и_распределительные_подстанции',
    ]
    const data = classifyDxfConstraints({
      ok: true,
      points: [],
      layers: names.map((name) => ({ name, segments: 1, points: 0 })),
      segments: names.map((name, index) => ({
        layer: name,
        points: [{ x: 0, y: index }, { x: 10, y: index }],
      })),
    })
    expect(data.roles['Люк_сетей_водоснабжения']).toBe('utility')
    expect(data.roles['Колодцы_системы_водоотведения']).toBe('utility')
    expect(data.roles['_центрального_водоснабжен']).toBe('utility')
    expect(data.roles['Рабочий_слой_крассных_лииний']).toBe('redLine')
    expect(data.roles['Понизительные_и_распределительные_подстанции']).toBe('structure')
    expect(data.utilityLines).toHaveLength(3)
    expect(data.redLines).toHaveLength(1)
  })

  it('не записывает в рельеф слой только за то, что у него есть отметки', () => {
    // Прежнее правило «в слое есть точки с конечным Z → terrain» на реальном
    // чертеже относило к рельефу растительность, кустарники, коды условных
    // знаков и слой `0` — 6 453 линии из 6 490, — и лист плана рисовал их
    // цветом горизонталей.
    const data = classifyDxfConstraints({
      ok: true,
      points: [{ x: 5, y: 5, z: 345.6 }],
      layers: [
        { name: 'растительность', segments: 1, points: 3, zMin: 344, zMax: 348 },
        { name: '71211200_Кустарники_заросли', segments: 1, points: 3, zMin: 344, zMax: 348 },
        { name: '0', segments: 1, points: 9, zMin: 333, zMax: 383 },
        { name: 'РЕЛЬЕФ', segments: 1, points: 0 },
      ],
      segments: [
        { layer: 'растительность', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { layer: '71211200_Кустарники_заросли', points: [{ x: 0, y: 2 }, { x: 10, y: 2 }] },
        { layer: '0', points: [{ x: 0, y: 4 }, { x: 10, y: 4 }] },
        { layer: 'РЕЛЬЕФ', points: [{ x: 0, y: 6 }, { x: 10, y: 6 }] },
      ],
    })
    expect(data.roles['растительность']).toBe('unknown')
    expect(data.roles['71211200_Кустарники_заросли']).toBe('unknown')
    expect(data.roles['0']).toBe('unknown')
    // Слой, названный рельефом, рельефом и остаётся.
    expect(data.roles['РЕЛЬЕФ']).toBe('terrain')
    expect(data.terrainLines).toHaveLength(1)
    // Ничего не потеряно: снятое с рельефа выводится ситуационной подложкой,
    // а отметки съёмки берутся из геометрии независимо от роли слоя.
    expect(data.contextLines).toHaveLength(4)
    expect(data.surveyPoints).toHaveLength(1)
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

import { describe, expect, it } from 'vitest'
import { assessRouteSurveyCoverage, buildEngineeringRoute } from './engineering-network'

const constraints = {
  georeference: { kind: 'local_anchor' as const, source: 'test control points' },
  corridorRings: [[
    { x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 220 }, { x: 0, y: 220 },
  ]],
  roadLines: [{ points: [{ x: 100, y: 0 }, { x: 100, y: 220 }] }],
  hardObstacleRings: [[{ x: 80, y: 180 }, { x: 90, y: 180 }, { x: 90, y: 190 }, { x: 80, y: 190 }]],
  unresolvedLayers: [],
  sourceDeclarations: {
    buildings: 'present' as const,
    utilities: 'confirmed_absent' as const,
    roads: 'present' as const,
    hydrography: 'confirmed_absent' as const,
    parcels: 'confirmed_absent' as const,
    protectionZones: 'confirmed_absent' as const,
  },
  surveyPoints: [0, 50, 100, 150, 200].flatMap((x) =>
    [0, 50, 100, 150, 200].map((y) => ({ x, y, z: 345 - x / 200 - y / 300 })),
  ),
}

describe('buildEngineeringRoute', () => {
  it('creates facility -> gravity -> LNS -> pressure -> outlet topology', () => {
    const result = buildEngineeringRoute({
      facilities: [
        { id: 'A', label: 'ОС A', x: 20, y: 20, designFlowLps: 40 },
        { id: 'B', label: 'ОС B', x: 20, y: 180, designFlowLps: 60 },
      ],
      lns: { id: 'LNS', label: 'ЛНС', x: 150, y: 100, designFlowLps: 100 },
      outlet: { id: 'OUTLET', label: 'Выпуск', x: 200, y: 100 },
      constraints,
      options: { gridSizeM: 10 },
      sourceSurveyPointCount: 25,
      pumpHeadM: 15,
    })
    expect(result.status).toBe('calculated')
    expect(result.network.nodes.filter((node) => node.id === 'LNS')).toHaveLength(1)
    expect(result.network.nodes.filter((node) => node.kind === 'treatment_facility')).toHaveLength(2)
    expect(result.network.nodes.some((node) => node.kind === 'pumping_station')).toBe(true)
    expect(result.network.nodes.some((node) => node.kind === 'outfall')).toBe(true)
    expect(result.network.pipes.some((pipe) => pipe.kind === 'gravity_main')).toBe(true)
    expect(result.network.pipes.some((pipe) => pipe.kind === 'pressure_main')).toBe(true)
  })

  it('reports an unbalanced LNS flow instead of inventing topology', () => {
    const result = buildEngineeringRoute({
      facilities: [{ id: 'A', label: 'ОС A', x: 20, y: 20, designFlowLps: 40 }],
      lns: { x: 150, y: 100, designFlowLps: 100 },
      outlet: { x: 200, y: 100 },
      constraints,
      pumpHeadM: 15,
    })
    expect(result.status).toBe('preliminary')
    expect(result.blockers.map((blocker) => blocker.code)).toContain('FLOW_BALANCE_MISMATCH')
  })

  it('blocks final status when the terrain model is missing', () => {
    const result = buildEngineeringRoute({
      facilities: [{ id: 'A', label: 'ОС A', x: 20, y: 20, designFlowLps: 40 }],
      lns: { x: 150, y: 100, designFlowLps: 40 },
      outlet: { x: 200, y: 100 },
      constraints: { ...constraints, surveyPoints: [] },
      pumpHeadM: 15,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.map((blocker) => blocker.code)).toContain('NO_TERRAIN')
    expect(result.network.pipes).toHaveLength(0)
  })

  it('does not generate project geometry while DWG layers remain unresolved', () => {
    const result = buildEngineeringRoute({
      facilities: [{ id: 'A', label: 'OS A', x: 20, y: 20, designFlowLps: 40 }],
      lns: { x: 150, y: 100, designFlowLps: 40 },
      outlet: { x: 200, y: 100 },
      constraints: { ...constraints, unresolvedLayers: ['0', 'UNKNOWN-OBJECTS'] },
      pumpHeadM: 15,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.map((blocker) => blocker.code)).toContain('UNRESOLVED_DWG_LAYERS')
    expect(result.network).toEqual({ nodes: [], pipes: [], totalLengthM: 0 })
    expect(result.paths.gravity).toHaveLength(0)
    expect(result.paths.pressure).toHaveLength(0)
  })

  it('requires explicit confirmation when an obstacle source is empty', () => {
    const result = buildEngineeringRoute({
      facilities: [{ id: 'A', label: 'OS A', x: 20, y: 20, designFlowLps: 40 }],
      lns: { x: 150, y: 100, designFlowLps: 40 },
      outlet: { x: 200, y: 100 },
      constraints: {
        ...constraints,
        hardObstacleRings: [],
        sourceDeclarations: { ...constraints.sourceDeclarations, buildings: 'unknown' },
      },
      pumpHeadM: 15,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.map((blocker) => blocker.code)).toContain('UNCONFIRMED_BUILDINGS')
    expect(result.network.pipes).toHaveLength(0)
  })
})

describe('assessRouteSurveyCoverage', () => {
  it('reports gaps along the axis instead of silently interpolating far away', () => {
    const report = assessRouteSurveyCoverage(
      [{ points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      20,
      50,
    )
    expect(report.sampledRoutePoints).toBeGreaterThan(5)
    expect(report.gapPoints).toBeGreaterThan(0)
    expect(report.maximumNearestM).toBeGreaterThan(100)
  })
})

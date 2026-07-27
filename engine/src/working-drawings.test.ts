import { describe, expect, it } from 'vitest'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import type { TracedNetwork } from './trace'
import { buildWorkingDrawingSet, workingDrawingMainPath } from './working-drawings'

const network: TracedNetwork = {
  nodes: [
    { id: 'A', kind: 'ring', x: 0, y: 0, groundElevation: 100 },
    { id: 'B', kind: 'ring', x: 500, y: 100, groundElevation: 99 },
    { id: 'OUT', kind: 'source', x: 1000, y: 0, groundElevation: 98 },
  ],
  pipes: [
    {
      id: 'AB', kind: 'gravity_collector', fromNode: 'A', toNode: 'B', lengthM: 540,
      alignment: [{ x: 0, y: 0 }, { x: 200, y: 50 }, { x: 500, y: 100 }],
      dataSource: 'designed:A*',
    },
    {
      id: 'BO', kind: 'gravity_collector', fromNode: 'B', toNode: 'OUT', lengthM: 530,
      alignment: [{ x: 1000, y: 0 }, { x: 800, y: 80 }, { x: 500, y: 100 }],
      dataSource: 'designed:A*',
    },
  ],
  totalLengthM: 1070,
}

const profile: GravityProfile = {
  stations: [
    { nodeId: 'A', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 1200 },
    { nodeId: 'B', chainageM: 540, groundElevationM: 99, invertElevationM: 96, depthM: 3, diameterMm: 1200 },
    { nodeId: 'OUT', chainageM: 1070, groundElevationM: 98, invertElevationM: 95, depthM: 3, diameterMm: 1600 },
  ],
  maxDepthM: 3,
  outletInvertElevationM: 95,
  totalLengthM: 1070,
}

const schedule: SewerSchedule = {
  manholes: [
    { label: 'К-1', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 1200 },
    { label: 'К-2', picket: 'ПК5+40', depthMm: 3000, pipeDiameterMm: 1200 },
    { label: 'Вып.', picket: 'ПК10+70', depthMm: 3000, pipeDiameterMm: 1600 },
  ],
  pipes: [],
  totalPipeLengthM: 1070,
}

const readyInput = () => ({
  system: 'storm' as const,
  network,
  profile,
  schedule,
  routeStatus: 'calculated' as const,
  georeference: { kind: 'local_anchor', source: '2 control points' },
  surveyPoints: [
    { x: 0, y: 0, z: 100 },
    { x: 500, y: 100, z: 99 },
    { x: 1000, y: 0, z: 98 },
  ],
  unresolvedLayerCount: 0,
  catalogReady: true,
  hydraulicsReady: true,
  utilityFeatureCount: 0,
  crossings: [],
  spatialBoreholeCount: 2,
  manholeCatalogReady: true,
  normsVerified: true,
})

describe('workingDrawingMainPath', () => {
  it('uses and orients actual pipe alignments instead of endpoint chords', () => {
    const result = workingDrawingMainPath(network, profile)
    expect(result.missingAlignmentPipeIds).toEqual([])
    expect(result.points.map(({ x, y }) => [x, y])).toEqual([
      [0, 0], [200, 50], [500, 100], [800, 80], [1000, 0],
    ])
    expect(result.points[result.points.length - 1].chainageM).toBeGreaterThan(1000)
  })

  it('reports every pipe whose alignment would otherwise become a straight chord', () => {
    const broken: TracedNetwork = {
      ...network,
      pipes: network.pipes.map((pipe, index) => index === 0 ? { ...pipe, alignment: undefined } : pipe),
    }
    const result = workingDrawingMainPath(broken, profile)
    expect(result.missingAlignmentPipeIds).toEqual(['AB'])
  })
})

describe('buildWorkingDrawingSet', () => {
  it('builds a data-driven register with contiguous plan/profile sheet numbers', () => {
    const set = buildWorkingDrawingSet(readyInput())
    expect(set.sheets.length).toBeGreaterThan(3)
    expect(set.sheets[0].sheetNumber).toBe(3)
    for (let index = 1; index < set.sheets.length; index++) {
      expect(set.sheets[index].sheetNumber).toBe(set.sheets[index - 1].sheetNumber + 1)
    }
    expect(set.sheets.filter((sheet) => sheet.kind === 'plan').length).toBeGreaterThanOrEqual(2)
    expect(set.sheets.filter((sheet) => sheet.kind === 'profile').length).toBeGreaterThanOrEqual(2)
    expect(set.sheets.some((sheet) => sheet.kind === 'detail')).toBe(true)
    expect(set.sheets.some((sheet) => sheet.kind === 'specification')).toBe(true)
    expect(set.summary.finalExportAllowed).toBe(true)
    expect(set.sheets.every((sheet) => sheet.status === 'VERIFIED')).toBe(true)
  })

  it('blocks plans when georeferencing or DWG classification is incomplete', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      georeference: { kind: 'unreferenced' },
      unresolvedLayerCount: 4,
    })
    const plan = set.sheets.find((sheet) => sheet.kind === 'plan')!
    expect(plan.status).toBe('BLOCKED')
    expect(plan.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      'GEOREFERENCE_MISSING', 'DWG_LAYERS_UNRESOLVED',
    ]))
    expect(set.summary.finalExportAllowed).toBe(false)
  })

  it('blocks profiles when crossing cards and spatial boreholes are missing', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      utilityFeatureCount: 6,
      crossings: [],
      spatialBoreholeCount: 0,
    })
    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(profileSheet.status).toBe('BLOCKED')
    expect(profileSheet.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      'CROSSING_CARDS_MISSING', 'SPATIAL_GEOLOGY_MISSING',
    ]))
    const crossingSheet = set.sheets.find((sheet) => sheet.id.startsWith('crossings-'))!
    expect(crossingSheet.status).toBe('BLOCKED')
    expect(crossingSheet.blockers.map((item) => item.code)).toContain('CROSSING_CARDS_MISSING')
  })

  it('requires complete structured crossing cards before issuing details', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      utilityFeatureCount: 1,
      crossings: [{ id: 'X-1', stationM: 250, kind: 'utility', source: 'classified DWG' }],
    })
    const crossingSheet = set.sheets.find((sheet) => sheet.id.startsWith('crossings-'))!
    expect(crossingSheet.status).toBe('BLOCKED')
    expect(crossingSheet.blockers[0].message).toContain('владелец')
    expect(crossingSheet.blockers[0].message).toContain('отметка существующей сети')
  })

  it('does not fabricate manhole quantities without a construction catalogue', () => {
    const set = buildWorkingDrawingSet({ ...readyInput(), manholeCatalogReady: false })
    const materialSheet = set.sheets.find((sheet) => sheet.kind === 'material_table')!
    expect(materialSheet.status).toBe('BLOCKED')
    expect(materialSheet.blockers.map((item) => item.code)).toContain('MANHOLE_CONSTRUCTION_MISSING')
  })

  it('changes sheet fingerprints when profile input changes', () => {
    const before = buildWorkingDrawingSet(readyInput())
    const changedProfile = {
      ...profile,
      stations: profile.stations.map((station, index) => index === 1 ? { ...station, invertElevationM: 95.5 } : station),
    }
    const after = buildWorkingDrawingSet({ ...readyInput(), profile: changedProfile })
    expect(after.inputHash).not.toBe(before.inputHash)
    expect(after.sheets.find((sheet) => sheet.kind === 'profile')?.inputHash)
      .not.toBe(before.sheets.find((sheet) => sheet.kind === 'profile')?.inputHash)
  })

  it('invalidates hashes when topography or geology changes without changing row counts', () => {
    const before = buildWorkingDrawingSet({ ...readyInput(), geologyFingerprint: [{ id: 'BH-1', water: 4.2 }] })
    const topographyChanged = buildWorkingDrawingSet({
      ...readyInput(),
      geologyFingerprint: [{ id: 'BH-1', water: 4.2 }],
      surveyPoints: readyInput().surveyPoints.map((point, index) => index === 1 ? { ...point, z: point.z - 0.35 } : point),
    })
    const geologyChanged = buildWorkingDrawingSet({ ...readyInput(), geologyFingerprint: [{ id: 'BH-1', water: 3.7 }] })
    expect(topographyChanged.inputHash).not.toBe(before.inputHash)
    expect(geologyChanged.inputHash).not.toBe(before.inputHash)
  })
})

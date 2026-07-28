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
  pipeIds: ['AB', 'BO'],
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

const deliverables = (overrides: Partial<{
  crossingDetailSheets: boolean
  protectiveGridDetail: boolean
}> = {}) => ({
  crossingDetailSheets: false,
  protectiveGridDetail: false,
  source: 'approved design brief',
  verified: true,
  ...overrides,
})

const protectiveGridDesign = {
  quantity: 3,
  overallWidthMm: 900,
  overallHeightMm: 700,
  barSpacingMm: 100,
  frameProfile: 'angle profile 50x5',
  barProfile: 'round bar 12',
  material: 'structural steel',
  coating: 'approved anti-corrosion system',
  fixing: 'four anchored hinges',
  source: 'approved product card PG-01',
  verified: true,
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
  stormRunoff: {
    available: true,
    verified: true,
    source: 'synthetic catchment calculation',
    detail: '3 verified catchments',
    blockers: [],
  },
  utilityFeatureCount: 0,
  crossings: [],
  spatialBoreholeCount: 2,
  geologyCoverage: {
    maxOffsetM: 75,
    status: 'verified' as const,
    source: 'approved geology coverage rule',
  },
  freezingDepth: {
    valueM: 1.8,
    status: 'verified' as const,
    source: 'engineering geology report',
  },
  manholeCatalogReady: true,
  normsVerified: true,
  deliverableRequirements: deliverables(),
})

describe('workingDrawingMainPath', () => {
  it('uses and orients actual pipe alignments instead of endpoint chords', () => {
    const result = workingDrawingMainPath(network, profile)
    expect(result.missingAlignmentPipeIds).toEqual([])
    expect(result.points.map(({ x, y }) => [x, y])).toEqual([
      [0, 0], [200, 50], [500, 100], [800, 80], [1000, 0],
    ])
    expect(result.points[0].chainageM).toBe(0)
    expect(result.points.find((point) => point.x === 500 && point.y === 100)?.chainageM).toBe(540)
    expect(result.points[result.points.length - 1].chainageM).toBe(1070)
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
    const workingSheets = set.sheets.filter((sheet) => sheet.documentSet === 'working_drawings')
    const specificationSheets = set.sheets.filter((sheet) => sheet.documentSet === 'specification')
    expect(workingSheets[0].sheetNumber).toBe(4)
    for (let index = 1; index < workingSheets.length; index++) {
      expect(workingSheets[index].sheetNumber).toBe(workingSheets[index - 1].sheetNumber + 1)
    }
    expect(specificationSheets.map((sheet) => sheet.sheetNumber)).toEqual([1])
    expect(set.sheets.map((sheet) => sheet.sequence)).toEqual(
      Array.from({ length: set.sheets.length }, (_, index) => index + 1),
    )
    expect(set.sheets.filter((sheet) => sheet.kind === 'plan').length).toBeGreaterThanOrEqual(2)
    expect(set.sheets.filter((sheet) => sheet.kind === 'network_plan')).toHaveLength(1)
    expect(set.sheets.filter((sheet) => sheet.kind === 'profile').length).toBeGreaterThanOrEqual(2)
    expect(set.sheets.some((sheet) => sheet.kind === 'detail')).toBe(false)
    expect(set.sheets.some((sheet) => sheet.kind === 'specification')).toBe(true)
    expect(set.summary.draftExportAllowed).toBe(true)
    expect(set.summary.finalExportAllowed).toBe(true)
    expect(set.sheets.every((sheet) => sheet.status === 'VERIFIED')).toBe(true)
  })

  it('keeps every branch alignment on the source-driven full-network plan', () => {
    const branchedNetwork: TracedNetwork = {
      ...network,
      nodes: [...network.nodes, { id: 'SIDE', kind: 'ring', x: 520, y: 360, groundElevation: 99 }],
      pipes: [...network.pipes, {
        id: 'BS', kind: 'gravity_collector', fromNode: 'B', toNode: 'SIDE', lengthM: 270,
        alignment: [{ x: 500, y: 100 }, { x: 510, y: 220 }, { x: 520, y: 360 }],
        dataSource: 'synthetic:branch',
      }],
    }
    const set = buildWorkingDrawingSet({ ...readyInput(), network: branchedNetwork })
    expect(set.networkPaths.map((path) => path.pipeId)).toEqual(['AB', 'BO', 'BS'])
    expect(set.mainPath.some((point) => point.x === 520 && point.y === 360)).toBe(false)
    const overview = set.sheets.find((sheet) => sheet.kind === 'network_plan')
    expect(overview?.status).toBe('VERIFIED')
    expect(overview?.variant).toBe('network_plan')
  })

  it('blocks only the full-network plan when a non-profile branch has no alignment', () => {
    const branchedNetwork: TracedNetwork = {
      ...network,
      nodes: [...network.nodes, { id: 'SIDE', kind: 'ring', x: 520, y: 360, groundElevation: 99 }],
      pipes: [...network.pipes, {
        id: 'BS', kind: 'gravity_collector', fromNode: 'B', toNode: 'SIDE', lengthM: 270,
        dataSource: 'synthetic:branch',
      }],
    }
    const set = buildWorkingDrawingSet({ ...readyInput(), network: branchedNetwork })
    const routePlan = set.sheets.find((sheet) => sheet.kind === 'plan')
    const overview = set.sheets.find((sheet) => sheet.kind === 'network_plan')
    expect(routePlan?.status).toBe('VERIFIED')
    expect(overview?.status).toBe('BLOCKED')
    expect(overview?.blockers.map((item) => item.code)).toContain('NETWORK_ALIGNMENT_MISSING')
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
      deliverableRequirements: deliverables({ crossingDetailSheets: true }),
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

  it('blocks final profiles when geology coverage is unverified', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      geologyCoverage: {
        maxOffsetM: 75,
        status: 'unverified',
        source: 'draft geology coverage rule',
      },
    })
    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(profileSheet.status).toBe('BLOCKED')
    expect(profileSheet.blockers.map((item) => item.code)).toContain('GEOLOGY_COVERAGE_UNVERIFIED')
    expect(profileSheet.sources.find((source) => source.requirement === 'geology')?.verified).toBe(false)
    expect(set.summary.finalExportAllowed).toBe(false)
    expect(set.inputHash).not.toBe(buildWorkingDrawingSet(readyInput()).inputHash)
  })

  it('keeps K2 hydraulic sheets in draft-blocked state without verified storm runoff', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      stormRunoff: {
        available: true,
        verified: false,
        source: 'draft catchment data',
        blockers: ['q20 is not verified'],
      },
    })
    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(profileSheet.status).toBe('BLOCKED')
    expect(profileSheet.blockers.map((item) => item.code)).toContain('STORM_RUNOFF_NOT_VERIFIED')
    expect(profileSheet.sources.find((source) => source.requirement === 'storm_runoff')?.verified).toBe(false)
    expect(set.summary.finalExportAllowed).toBe(false)
  })

  it('blocks final profiles when freezing depth is missing or unverified', () => {
    const missing = buildWorkingDrawingSet({ ...readyInput(), freezingDepth: undefined })
    const missingProfile = missing.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(missingProfile.status).toBe('BLOCKED')
    expect(missingProfile.blockers.map((item) => item.code)).toContain('FREEZING_DEPTH_UNVERIFIED')

    const unverified = buildWorkingDrawingSet({
      ...readyInput(),
      freezingDepth: { valueM: 1.8, status: 'unverified', source: 'draft regional value' },
    })
    const unverifiedProfile = unverified.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(unverifiedProfile.blockers.map((item) => item.code)).toContain('FREEZING_DEPTH_UNVERIFIED')
    expect(unverifiedProfile.sources.find((source) => source.requirement === 'freezing_depth')?.verified).toBe(false)
    expect(unverified.summary.finalExportAllowed).toBe(false)
    expect(unverified.inputHash).not.toBe(buildWorkingDrawingSet(readyInput()).inputHash)
  })

  it('requires complete structured crossing cards before issuing details', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      utilityFeatureCount: 1,
      crossings: [{ id: 'X-1', stationM: 250, kind: 'utility', source: 'classified DWG' }],
      deliverableRequirements: deliverables({ crossingDetailSheets: true }),
    })
    const crossingSheet = set.sheets.find((sheet) => sheet.id.startsWith('crossings-'))!
    expect(crossingSheet.status).toBe('BLOCKED')
    expect(crossingSheet.blockers[0].message).toContain('владелец')
    expect(crossingSheet.blockers[0].message).toContain('отметка существующей сети')
  })

  it('blocks a crossing whose confirmed clearance is below the required clearance', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      utilityFeatureCount: 1,
      crossings: [{
        id: 'X-LOW', stationM: 250, kind: 'utility', owner: 'utility owner', size: 'DN300',
        source: 'classified survey', existingElevationM: 98.4, designInvertElevationM: 98.0,
        clearanceM: 0.4, requiredClearanceM: 0.5, method: 'case crossing', approved: true,
      }],
      deliverableRequirements: deliverables({ crossingDetailSheets: true }),
    })
    const crossingSheet = set.sheets.find((sheet) => sheet.variant === 'crossing_detail')!
    expect(crossingSheet.status).toBe('BLOCKED')
    expect(crossingSheet.blockers.map((item) => item.code)).toContain('CROSSING_CLEARANCE_INSUFFICIENT')
    expect(set.summary.finalExportAllowed).toBe(false)
  })

  it('blocks final issue when the approved deliverable composition is unknown', () => {
    const set = buildWorkingDrawingSet({ ...readyInput(), deliverableRequirements: undefined })
    expect(set.sheets.some((sheet) => sheet.blockers.some((item) => item.code === 'DELIVERABLE_REQUIREMENTS_MISSING'))).toBe(true)
    expect(set.summary.finalExportAllowed).toBe(false)
  })

  it('blocks final profiles when a gravity branch is absent from the longitudinal profile', () => {
    const branchNetwork: TracedNetwork = {
      ...network,
      nodes: [...network.nodes, { id: 'C', kind: 'ring', x: 400, y: 300, groundElevation: 100 }],
      pipes: [...network.pipes, {
        id: 'CB', kind: 'gravity_collector', fromNode: 'C', toNode: 'B', lengthM: 230,
        alignment: [{ x: 400, y: 300 }, { x: 450, y: 200 }, { x: 500, y: 100 }],
        dataSource: 'designed:A*',
      }],
      totalLengthM: 1300,
    }
    const set = buildWorkingDrawingSet({ ...readyInput(), network: branchNetwork })
    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    expect(profileSheet.blockers.map((item) => item.code)).toContain('PROFILE_BRANCHES_MISSING')
    expect(set.summary.finalExportAllowed).toBe(false)
  })

  it('does not fabricate manhole quantities without a construction catalogue', () => {
    const set = buildWorkingDrawingSet({ ...readyInput(), manholeCatalogReady: false })
    const materialSheet = set.sheets.find((sheet) => sheet.kind === 'material_table')!
    expect(materialSheet.status).toBe('BLOCKED')
    expect(materialSheet.blockers.map((item) => item.code)).toContain('MANHOLE_CONSTRUCTION_MISSING')
  })

  it('does not invent separate crossing sheets merely because utilities exist', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      utilityFeatureCount: 1,
      crossings: [{ id: 'X-1', stationM: 250, kind: 'utility' }],
      deliverableRequirements: deliverables({ crossingDetailSheets: false }),
    })
    expect(set.sheets.some((sheet) => sheet.variant === 'crossing_detail')).toBe(false)
  })

  it('blocks a required protective-grid sheet until every product parameter is confirmed', () => {
    const blocked = buildWorkingDrawingSet({
      ...readyInput(),
      deliverableRequirements: deliverables({ protectiveGridDetail: true }),
      protectiveGridDesign: null,
    })
    const blockedSheet = blocked.sheets.find((sheet) => sheet.variant === 'protective_grid')!
    expect(blockedSheet.status).toBe('BLOCKED')
    expect(blockedSheet.blockers.map((item) => item.code)).toContain('PROTECTIVE_GRID_DESIGN_MISSING')
    expect(blocked.summary.finalExportAllowed).toBe(false)

    const verified = buildWorkingDrawingSet({
      ...readyInput(),
      deliverableRequirements: deliverables({ protectiveGridDetail: true }),
      protectiveGridDesign,
    })
    const verifiedSheet = verified.sheets.find((sheet) => sheet.variant === 'protective_grid')!
    expect(verifiedSheet.status).toBe('VERIFIED')
    expect(verified.protectiveGridDesign).toEqual(protectiveGridDesign)
    expect(verified.summary.finalExportAllowed).toBe(true)
  })

  it('invalidates the register when a confirmed protective-grid dimension changes', () => {
    const before = buildWorkingDrawingSet({
      ...readyInput(),
      deliverableRequirements: deliverables({ protectiveGridDetail: true }),
      protectiveGridDesign,
    })
    const after = buildWorkingDrawingSet({
      ...readyInput(),
      deliverableRequirements: deliverables({ protectiveGridDetail: true }),
      protectiveGridDesign: { ...protectiveGridDesign, barSpacingMm: 120 },
    })
    expect(after.inputHash).not.toBe(before.inputHash)
    expect(after.sheets.find((sheet) => sheet.variant === 'protective_grid')?.inputHash)
      .not.toBe(before.sheets.find((sheet) => sheet.variant === 'protective_grid')?.inputHash)
  })

  it('assigns each material row to exactly one deterministic sheet range', () => {
    const manholes = Array.from({ length: 5 }, (_, index) => ({
      label: `K-${index + 1}`,
      picket: `PK${index}`,
      depthMm: 2500 + index * 100,
      pipeDiameterMm: 800,
    }))
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      schedule: { ...schedule, manholes },
      options: { materialRowsPerSheet: 2 },
    })
    const ranges = set.sheets
      .filter((sheet) => sheet.kind === 'material_table')
      .map((sheet) => sheet.dataRange)
    expect(ranges).toEqual([
      { start: 0, end: 2, total: 5 },
      { start: 2, end: 4, total: 5 },
      { start: 4, end: 5, total: 5 },
    ])
    expect(ranges.flatMap((range) => range
      ? Array.from({ length: range.end - range.start }, (_, index) => range.start + index)
      : [])).toEqual([0, 1, 2, 3, 4])
    expect(set.layoutPolicy.materialRowsPerSheet).toBe(2)
  })

  it('paginates the independent specification set without duplicating row ranges', () => {
    const set = buildWorkingDrawingSet({
      ...readyInput(),
      specificationItemCount: 41,
      options: { specificationRowsPerSheet: 20 },
    })
    const specificationSheets = set.sheets.filter((sheet) => sheet.documentSet === 'specification')
    expect(specificationSheets.map((sheet) => ({
      sheetNumber: sheet.sheetNumber,
      sequence: sheet.sequence,
      range: sheet.dataRange,
    }))).toEqual([
      { sheetNumber: 1, sequence: set.sheets.length - 2, range: { start: 0, end: 20, total: 41 } },
      { sheetNumber: 2, sequence: set.sheets.length - 1, range: { start: 20, end: 40, total: 41 } },
      { sheetNumber: 3, sequence: set.sheets.length, range: { start: 40, end: 41, total: 41 } },
    ])
    expect(specificationSheets.flatMap((sheet) => {
      const range = sheet.dataRange!
      return Array.from({ length: range.end - range.start }, (_, index) => range.start + index)
    })).toEqual(Array.from({ length: 41 }, (_, index) => index))
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

  it('invalidates hashes when topology, schedule or spatial constraints change', () => {
    const before = buildWorkingDrawingSet({ ...readyInput(), constraintsFingerprint: { roads: [[0, 1]] } })
    const topologyChanged = buildWorkingDrawingSet({
      ...readyInput(),
      network: {
        ...network,
        nodes: network.nodes.map((node, index) => index === 1 ? { ...node, x: node.x + 2 } : node),
      },
      constraintsFingerprint: { roads: [[0, 1]] },
    })
    const scheduleChanged = buildWorkingDrawingSet({
      ...readyInput(),
      schedule: { ...schedule, totalPipeLengthM: schedule.totalPipeLengthM + 1 },
      constraintsFingerprint: { roads: [[0, 1]] },
    })
    const constraintsChanged = buildWorkingDrawingSet({ ...readyInput(), constraintsFingerprint: { roads: [[0, 2]] } })
    expect(topologyChanged.inputHash).not.toBe(before.inputHash)
    expect(scheduleChanged.inputHash).not.toBe(before.inputHash)
    expect(constraintsChanged.inputHash).not.toBe(before.inputHash)
  })
})

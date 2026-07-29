import { describe, expect, it } from 'vitest'
import { SYNTHETIC_BASIS_FILES } from './basisDemo'
import { classifySyntheticDemoTarget, projectPipelineMode } from './projectActions'

const emptyCounts = {
  datasetKinds: [] as string[],
  buildingCount: 0,
  nodeCount: 0,
  pipeCount: 0,
  parcelCount: 0,
  catalogCount: 0,
  boreholeCount: 0,
}

describe('project action safety', () => {
  it('routes K1 and K2 through the gravity calculation CTA', () => {
    expect(projectPipelineMode('water')).toBe('pressure')
    expect(projectPipelineMode('sewer')).toBe('gravity')
    expect(projectPipelineMode('storm')).toBe('gravity')
  })

  it('allows an empty project and an already synthetic project', () => {
    expect(classifySyntheticDemoTarget(emptyCounts)).toBe('empty')
    expect(classifySyntheticDemoTarget({ ...emptyCounts, datasetKinds: ['region'] })).toBe('empty')
    expect(classifySyntheticDemoTarget({
      ...emptyCounts,
      datasetKinds: ['basis', 'topography'],
      buildingCount: 4,
      routeReport: { synthetic: true },
      routeStatus: 'preliminary',
      basisContent: { mode: 'synthetic', files: SYNTHETIC_BASIS_FILES, referenceFiles: [] },
    })).toBe('synthetic')
    expect(classifySyntheticDemoTarget({
      ...emptyCounts,
      datasetKinds: ['topography', 'route_constraints'],
      routeReport: { synthetic: true, seedReady: false },
      routeStatus: 'blocked',
    })).toBe('synthetic')
  })

  it('blocks demo replacement when real inputs are present', () => {
    expect(classifySyntheticDemoTarget({ ...emptyCounts, nodeCount: 2 })).toBe('real')
    expect(classifySyntheticDemoTarget({
      ...emptyCounts,
      datasetKinds: ['basis', 'topography'],
      routeReport: { synthetic: true },
      routeStatus: 'preliminary',
      basisContent: {
        mode: 'synthetic',
        files: { ...SYNTHETIC_BASIS_FILES, apz: 'signed-owner-apz.pdf' },
      },
    })).toBe('real')
    expect(classifySyntheticDemoTarget({
      ...emptyCounts,
      datasetKinds: ['basis', 'topography'],
      routeReport: { synthetic: true },
      routeStatus: 'preliminary',
      basisContent: {
        mode: 'synthetic',
        files: SYNTHETIC_BASIS_FILES,
        referenceFiles: ['private-reference.pdf'],
      },
    })).toBe('real')
    expect(classifySyntheticDemoTarget({
      ...emptyCounts,
      datasetKinds: ['topography'],
      routeReport: { synthetic: true },
      routeStatus: 'stale',
      basisContent: { mode: 'synthetic', files: SYNTHETIC_BASIS_FILES },
    })).toBe('real')
  })
})

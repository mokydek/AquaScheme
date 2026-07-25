import { describe, expect, it } from 'vitest'
import projectData from '../../frontend/src/shared/realProjectData.json'
import { compareRouteToReference, traceConstrainedNetwork } from './constrained-route'

const pointSegmentDistance = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

describe('constrained routing', () => {
  it('routes the real project terminals through the supplied engineering corridor', () => {
    const result = traceConstrainedNetwork(
      projectData.inflows.map((inflow, index) => ({ id: `T${index + 1}`, buildingId: `B${index + 1}`, x: inflow.x, y: inflow.y })),
      projectData.outlet,
      { corridorRings: [projectData.corridor], surveyPoints: projectData.surveyPoints },
      { gridSizeM: 15 },
    )
    expect(result.report.ok).toBe(true)
    expect(result.report.routedTerminals).toBe(4)
    expect(result.report.outsideCorridorSegments).toBe(0)
    expect(result.network.pipes.length).toBeGreaterThan(10)
    expect(result.network.pipes.length).toBeLessThan(100)

    const southernBranch = result.paths.find((path) => path.terminalId === 'T4')
    expect(southernBranch).toBeDefined()
    const direct = Math.hypot(
      projectData.inflows[3].x - projectData.inflows[2].x,
      projectData.inflows[3].y - projectData.inflows[2].y,
    )
    const branchLength = southernBranch!.points.slice(1).reduce(
      (sum, point, index) => sum + Math.hypot(point.x - southernBranch!.points[index].x, point.y - southernBranch!.points[index].y),
      0,
    )
    const straightDeviation = Math.max(...southernBranch!.points.map((point) =>
      pointSegmentDistance(point, projectData.inflows[2], projectData.inflows[3]),
    ))
    // ОС III-8 -> ОС III-4 must follow the folded southern DWG corridor.
    // A direct chord is shorter but crosses the broad false polygon interior.
    expect(branchLength).toBeGreaterThan(direct * 1.04)
    expect(straightDeviation).toBeGreaterThan(180)

    const generatedSegments = result.paths.flatMap((path) => path.points.slice(1).map((point, index) => [path.points[index], point] as const))
    const distances = projectData.route.map((point) => Math.min(...generatedSegments.map(([a, b]) => pointSegmentDistance(point, a, b))))
    const benchmark = compareRouteToReference(result.paths, projectData.route)
    expect(Math.max(...distances)).toBeLessThan(25)
    expect(distances.reduce((sum, value) => sum + value, 0) / distances.length).toBeLessThan(10)
    // The accepted album stores sparse chords while the generated route follows
    // every bend of the narrower DWG corridor, hence use this as a diagnostic,
    // not as an input or a requirement to cut outside the corridor.
    expect(benchmark.referenceCoveragePct).toBeGreaterThan(70)
    expect(benchmark.maximumDeviationM).toBeLessThan(210)
  })

  it('keeps the complete interior of an ordinary wide corridor', () => {
    const result = traceConstrainedNetwork(
      [{ id: 'wide', x: 110, y: 60 }],
      { x: 10, y: 60 },
      { corridorRings: [[{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }]] },
      { gridSizeM: 10 },
    )
    expect(result.report.ok).toBe(true)
    expect(Math.max(...result.paths[0].points.map((point) => Math.abs(point.y - 60)))).toBeLessThanOrEqual(1)
  })

  it('routes around a hard building footprint instead of drawing a chord through it', () => {
    const obstacle = [{ x: 40, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 70 }, { x: 40, y: 70 }]
    const input = {
      corridorRings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]],
      hardObstacleRings: [obstacle],
    }
    const result = traceConstrainedNetwork([{ id: 'A', x: 10, y: 50 }], { x: 90, y: 50 }, input, { gridSizeM: 5 })
    expect(result.report.ok).toBe(true)
    expect(Math.max(...result.paths[0].points.map((point) => Math.abs(point.y - 50)))).toBeGreaterThanOrEqual(20)
    expect(result.paths[0].points.every((point) => !(point.x > 40 && point.x < 60 && point.y > 30 && point.y < 70))).toBe(true)
  })

  it('permits a required water crossing only inside an approved window', () => {
    const corridor = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]]
    const waterLines = [{ points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }]
    const rejected = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 50 }],
      { x: 90, y: 50 },
      { corridorRings: corridor, waterLines },
      { gridSizeM: 5, requireApprovedWaterCrossings: true },
    )
    expect(rejected.report.ok).toBe(false)

    const accepted = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 50 }],
      { x: 90, y: 50 },
      {
        corridorRings: corridor,
        waterLines,
        approvedCrossingRings: [[{ x: 45, y: 0 }, { x: 55, y: 0 }, { x: 55, y: 100 }, { x: 45, y: 100 }]],
      },
      { gridSizeM: 5, requireApprovedWaterCrossings: true },
    )
    expect(accepted.report.ok).toBe(true)
    expect(accepted.report.waterCrossings).toBeGreaterThan(0)
  })

  it('is deterministic for identical engineering inputs', () => {
    const constraints = {
      corridorRings: [[{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }]],
      hardObstacleRings: [[{ x: 50, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 80 }, { x: 50, y: 80 }]],
    }
    const first = traceConstrainedNetwork([{ id: 'A', x: 10, y: 60 }], { x: 110, y: 60 }, constraints, { gridSizeM: 5 })
    const second = traceConstrainedNetwork([{ id: 'A', x: 10, y: 60 }], { x: 110, y: 60 }, constraints, { gridSizeM: 5 })
    expect(second.paths).toEqual(first.paths)
    expect(second.network).toEqual(first.network)

    const withVisualMapReference = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 60 }],
      { x: 110, y: 60 },
      { ...constraints, georeference: { kind: 'local_anchor', source: 'visual map only' } },
      { gridSizeM: 5 },
    )
    expect(withVisualMapReference.network).toEqual(first.network)
  })

  it('registers every structured utility crossing for vertical review', () => {
    const result = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 50 }],
      { x: 90, y: 50 },
      {
        corridorRings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]],
        utilityLines: [
          { points: [{ x: 35, y: 0 }, { x: 35, y: 100 }] },
          { points: [{ x: 65, y: 0 }, { x: 65, y: 100 }] },
        ],
      },
      { gridSizeM: 5 },
    )
    expect(result.report.ok).toBe(true)
    expect(result.report.utilityCrossings).toBeGreaterThanOrEqual(2)
    expect(result.report.warnings.join(' ')).toContain('высотная проверка')
  })
})

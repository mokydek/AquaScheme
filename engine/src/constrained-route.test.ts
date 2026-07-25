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
    expect(result.network.pipes.length).toBeGreaterThan(100)

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
})

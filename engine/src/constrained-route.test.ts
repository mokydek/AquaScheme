import { describe, expect, it } from 'vitest'
import { traceConstrainedNetwork } from './constrained-route'

describe('constrained routing', () => {
  it('follows a synthetic folded corridor instead of joining endpoints by a chord', () => {
    const corridorRings = [
      [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 40 }, { x: 0, y: 40 }],
      [{ x: 120, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 180 }, { x: 120, y: 180 }],
      [{ x: 120, y: 140 }, { x: 200, y: 140 }, { x: 200, y: 180 }, { x: 120, y: 180 }],
    ]
    const result = traceConstrainedNetwork(
      [{ id: 'terminal', buildingId: 'building', x: 180, y: 160 }],
      { x: 20, y: 20 },
      { corridorRings },
      { gridSizeM: 5 },
    )
    expect(result.report.ok).toBe(true)
    expect(result.report.routedTerminals).toBe(1)
    expect(result.report.outsideCorridorSegments).toBe(0)
    expect(result.network.pipes.every((pipe) => pipe.dataSource?.includes('corridor=validated'))).toBe(true)

    const points = result.paths[0].points
    const direct = Math.hypot(160, 140)
    const routed = points.slice(1).reduce(
      (sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y),
      0,
    )
    expect(routed).toBeGreaterThan(direct * 1.1)
    expect(points.some((point) => point.x >= 120 && point.y <= 40)).toBe(true)
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

  it('does not let simplification replace a guide-axis route with a direct chord', () => {
    const result = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 20 }],
      { x: 90, y: 20 },
      {
        corridorRings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]],
        guideLines: [{ points: [{ x: 5, y: 80 }, { x: 95, y: 80 }] }],
      },
      { gridSizeM: 5, boundaryPenalty: 0, guideDistancePenalty: 20, guideAttractionM: 60, turnPenalty: 0 },
    )
    expect(result.report.ok).toBe(true)
    expect(result.paths[0].points.length).toBeGreaterThan(2)
    expect(Math.max(...result.paths[0].points.map((point) => point.y))).toBeGreaterThanOrEqual(55)
  })

  it('treats a protection zone as a hard barrier outside an approved crossing', () => {
    const corridorRings = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]]
    const protectionZoneRings = [[{ x: 40, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 100 }, { x: 40, y: 100 }]]
    const blocked = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 50 }],
      { x: 90, y: 50 },
      { corridorRings, protectionZoneRings },
      { gridSizeM: 5 },
    )
    expect(blocked.report.ok).toBe(false)

    const approved = traceConstrainedNetwork(
      [{ id: 'A', x: 10, y: 50 }],
      { x: 90, y: 50 },
      {
        corridorRings,
        protectionZoneRings,
        approvedCrossingRings: [[{ x: 35, y: 45 }, { x: 65, y: 45 }, { x: 65, y: 55 }, { x: 35, y: 55 }]],
      },
      { gridSizeM: 5 },
    )
    expect(approved.report.ok).toBe(true)
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

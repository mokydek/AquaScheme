import { describe, expect, it } from 'vitest'
import { buildSyntheticStormPlanContext } from './stormDemoPlanContext'

describe('synthetic storm plan context', () => {
  it('contains visible relief, road edges, labels and symbols instead of only a route axis', () => {
    const context = buildSyntheticStormPlanContext()
    expect(context.cadContextLines.length).toBeGreaterThan(10)
    expect(context.terrainLines.length).toBeGreaterThan(20)
    expect(context.cadTextEntities.length).toBeGreaterThan(5)
    expect(context.cadBlockEntities.length).toBeGreaterThan(5)
    expect(context.roadLines).toHaveLength(2)
    expect(context.terrainLines.every((line) => (
      Math.max(...line.points.map((point) => point.x)) - Math.min(...line.points.map((point) => point.x)) <= 120
    ))).toBe(true)
  })
})

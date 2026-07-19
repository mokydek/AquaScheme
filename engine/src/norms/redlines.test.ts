import { describe, expect, it } from 'vitest'
import { checkRouteInCorridor } from './redlines'

// A 100-wide corridor strip along x = 0..1000.
const CORRIDOR = [[
  { x: 0, y: -50 },
  { x: 1000, y: -50 },
  { x: 1000, y: 50 },
  { x: 0, y: 50 },
]]

describe('checkRouteInCorridor', () => {
  it('passes a route fully inside the corridor', () => {
    const check = checkRouteInCorridor(
      [{ x: 10, y: 0 }, { x: 500, y: 20 }, { x: 990, y: -20 }],
      CORRIDOR,
    )
    expect(check.inside.value).toBe(true)
    expect(check.inside.refs).toContain('route.redLines')
    expect(check.violations).toHaveLength(0)
  })

  it('reports vertices outside with their chainage', () => {
    const check = checkRouteInCorridor(
      [{ x: 10, y: 0 }, { x: 510, y: 200 }, { x: 990, y: 0 }],
      CORRIDOR,
    )
    expect(check.inside.value).toBe(false)
    const v = check.violations.find((x) => x.kind === 'vertexOutside')
    expect(v?.index).toBe(1)
    expect(v?.stationM).toBeCloseTo(Math.hypot(500, 200), 1)
  })

  it('fails honestly when no corridor is loaded', () => {
    const check = checkRouteInCorridor([{ x: 0, y: 0 }, { x: 10, y: 0 }], [])
    expect(check.inside.value).toBe(false)
    expect(check.violations).toHaveLength(0)
  })
})

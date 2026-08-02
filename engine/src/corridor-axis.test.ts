import { describe, expect, it } from 'vitest'
import type { ImportPoint } from './importnet'
import { corridorAxis } from './corridor-axis'

/** A strip of the given half-width around a centreline, as a closed ring. */
function strip(centre: ImportPoint[], halfWidth: number): ImportPoint[] {
  const offset = (side: 1 | -1) => centre.map((point, index) => {
    const previous = centre[Math.max(0, index - 1)]
    const next = centre[Math.min(centre.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const norm = Math.hypot(dx, dy) || 1
    return { x: point.x + (side * -dy * halfWidth) / norm, y: point.y + (side * dx * halfWidth) / norm }
  })
  return [...offset(1), ...offset(-1).reverse()]
}

const straight: ImportPoint[] = Array.from({ length: 41 }, (_, i) => ({ x: i * 25, y: 0 }))

describe('axis recovered from a corridor strip', () => {
  it('returns the centreline of a straight corridor with its width', () => {
    const axis = corridorAxis(strip(straight, 7.5))
    expect(axis.ok).toBe(true)
    expect(axis.widthM).toBeCloseTo(15, 0)
    expect(axis.estimatedWidthM).toBeCloseTo(15, 0)
    // A 1000 m strip, less the ~3 widths at each end where a point has no
    // partner far enough along the ring to measure against.
    expect(axis.lengthM).toBeGreaterThan(880)
    expect(axis.lengthM).toBeLessThan(1000)
    expect(axis.points.every((point) => Math.abs(point.y) < 0.5)).toBe(true)
  })

  it('follows a corridor that bends', () => {
    const bent: ImportPoint[] = []
    for (let i = 0; i <= 30; i++) bent.push({ x: i * 20, y: 0 })
    for (let i = 1; i <= 30; i++) bent.push({ x: 600, y: i * 20 })
    const axis = corridorAxis(strip(bent, 7.5))
    expect(axis.ok).toBe(true)
    expect(axis.lengthM).toBeGreaterThan(1050)
    expect(axis.lengthM).toBeLessThan(1300)
    // The bend is kept: a straight line between the ends would be far shorter.
    const chord = Math.hypot(
      axis.points[axis.points.length - 1].x - axis.points[0].x,
      axis.points[axis.points.length - 1].y - axis.points[0].y,
    )
    expect(axis.lengthM).toBeGreaterThan(chord * 1.3)
  })

  it('simplifies to the handful of vertices a design axis really has', () => {
    const axis = corridorAxis(strip(straight, 7.5))
    // The ring is resampled every 5 m, so a naive result would be ~200 points.
    expect(axis.points.length).toBeLessThan(20)
    expect(axis.points.length).toBeGreaterThanOrEqual(2)
  })

  it('refuses a contour that is not a narrow band', () => {
    const square: ImportPoint[] = [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 },
      { x: 0, y: 300 }, { x: 0, y: 200 }, { x: 0, y: 100 }, { x: 0, y: 50 },
    ]
    const axis = corridorAxis(square)
    expect(axis.ok).toBe(false)
    expect(axis.reason).toContain('не является узкой полосой')
    // The measured geometry is still reported so the caller can say why.
    expect(axis.estimatedWidthM).toBeGreaterThan(50)
  })

  it('rejects a ring too coarse to hold an axis', () => {
    expect(corridorAxis([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]).ok).toBe(false)
  })

  it('says the axis needs an engineer rather than presenting it as approved', () => {
    const axis = corridorAxis(strip(straight, 7.5))
    expect(axis.reason).toContain('не утверждённая проектом ось')
    expect(axis.reason).toContain('подтверждает инженер')
  })
})

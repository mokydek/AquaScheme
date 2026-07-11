import { describe, expect, it } from 'vitest'
import { similarityTransform } from './georef'

describe('similarityTransform', () => {
  it('handles translation, rotation and scale from two control points', () => {
    // Source axis (0,0)->(10,0) maps to target (100,100)->(100,110):
    // rotation 90 degrees, scale 1, translation (100,100).
    const transform = similarityTransform(
      { from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
      { from: { x: 10, y: 0 }, to: { x: 100, y: 110 } },
    )
    const a = transform(10, 0)
    expect(a.x).toBeCloseTo(100, 9)
    expect(a.y).toBeCloseTo(110, 9)
    const b = transform(0, 10)
    expect(b.x).toBeCloseTo(90, 9)
    expect(b.y).toBeCloseTo(100, 9)
  })

  it('scales uniformly', () => {
    const transform = similarityTransform(
      { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      { from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
    )
    const p = transform(5, 5)
    expect(p.x).toBeCloseTo(10, 9)
    expect(p.y).toBeCloseTo(10, 9)
  })

  it('throws when the control points coincide', () => {
    expect(() =>
      similarityTransform(
        { from: { x: 1, y: 1 }, to: { x: 0, y: 0 } },
        { from: { x: 1, y: 1 }, to: { x: 5, y: 5 } },
      ),
    ).toThrow()
  })
})

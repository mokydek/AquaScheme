import { describe, expect, it } from 'vitest'
import { estimateRoughnessMm, summarizeAct } from './reconstruction'

describe('estimateRoughnessMm', () => {
  it('returns the fresh roughness at zero wear', () => {
    expect(estimateRoughnessMm('steel', 0)).toBeCloseTo(0.1, 3)
  })

  it('grows with wear towards the worn value', () => {
    const mid = estimateRoughnessMm('steel', 50)
    expect(mid).toBeGreaterThan(estimateRoughnessMm('steel', 0))
    expect(mid).toBeLessThan(estimateRoughnessMm('steel', 100))
    expect(estimateRoughnessMm('steel', 100)).toBeCloseTo(2.0, 3)
  })

  it('adds an increment for overgrowth', () => {
    expect(estimateRoughnessMm('cast_iron', 50, 100)).toBeGreaterThan(estimateRoughnessMm('cast_iron', 50, 0))
  })

  it('keeps plastic pipes smooth', () => {
    expect(estimateRoughnessMm('pe', 100)).toBeLessThan(0.3)
  })

  it('clamps out of range wear', () => {
    expect(estimateRoughnessMm('steel', 200)).toBeCloseTo(2.0, 3)
    expect(estimateRoughnessMm('steel', -50)).toBeCloseTo(0.1, 3)
  })
})

describe('summarizeAct', () => {
  it('totals lengths and counts by decision', () => {
    const summary = summarizeAct([
      { id: 'a', lengthM: 100, decision: 'keep' },
      { id: 'b', lengthM: 200, decision: 'replace' },
      { id: 'c', lengthM: 50, decision: 'rehabilitate' },
      { id: 'd', lengthM: 150, decision: 'replace' },
    ])
    expect(summary.totalLengthM).toBe(500)
    expect(summary.replaceLengthM).toBe(350)
    expect(summary.keepLengthM).toBe(100)
    expect(summary.rehabilitateLengthM).toBe(50)
    expect(summary.counts.replace).toBe(2)
  })
})

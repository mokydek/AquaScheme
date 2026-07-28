import { describe, expect, it } from 'vitest'
import { sewerBurialDepthConstraints } from './sewer'

const diametersMm = [150, 200, 250, 500, 501, 600, 1200, 2400]
const freezingDepthsM = [0, 0.8, 1, 1.5, 2, 3, 5]
const cases = diametersMm.flatMap((diameterMm) =>
  freezingDepthsM.map((freezingDepthM) => ({ diameterMm, freezingDepthM })),
)

describe('SN RK 4.01-03-2013 clause 7.2.4 burial matrix', () => {
  it.each(cases)(
    'resolves unlike frost/invert and crown-cover limits for D=$diameterMm mm, frost=$freezingDepthM m',
    ({ diameterMm, freezingDepthM }) => {
      const result = sewerBurialDepthConstraints(diameterMm, freezingDepthM)
      const reductionM = diameterMm <= 500 ? 0.3 : 0.5
      const expectedFrostM = Math.max(0, freezingDepthM - reductionM)
      const expectedCrownInvertM = 0.7 + diameterMm / 1000
      const expectedMinimumM = Math.max(expectedFrostM, expectedCrownInvertM)

      expect(result.frostReductionM).toBe(reductionM)
      expect(result.frostInvertDepthM).toBeCloseTo(expectedFrostM, 9)
      expect(result.minimumCrownCoverM).toBe(0.7)
      expect(result.crownCoverInvertDepthM).toBeCloseTo(expectedCrownInvertM, 9)
      expect(result.minimumInvertDepthM).toBeCloseTo(expectedMinimumM, 9)
      expect(result.minimumInvertDepthM - result.diameterM).toBeGreaterThanOrEqual(0.7 - 1e-9)
      expect(result.minimumInvertDepthM).toBeGreaterThanOrEqual(result.frostInvertDepthM)

      const difference = expectedFrostM - expectedCrownInvertM
      expect(result.governingConstraint).toBe(
        Math.abs(difference) < 1e-9 ? 'both' : difference > 0 ? 'frost' : 'crown-cover',
      )
    },
  )

  it.each([
    { diameterMm: 0, freezingDepthM: 1.5, field: 'diameterMm' },
    { diameterMm: -200, freezingDepthM: 1.5, field: 'diameterMm' },
    { diameterMm: 200, freezingDepthM: -0.01, field: 'freezingDepthM' },
    { diameterMm: Number.NaN, freezingDepthM: 1.5, field: 'diameterMm' },
  ])('rejects invalid physical input $field', ({ diameterMm, freezingDepthM, field }) => {
    expect(() => sewerBurialDepthConstraints(diameterMm, freezingDepthM)).toThrow(field)
  })
})

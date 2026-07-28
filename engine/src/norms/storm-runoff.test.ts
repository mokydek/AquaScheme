import { describe, expect, it } from 'vitest'
import {
  calculateStormRunoff,
  imperviousSurfaceCoefficientZ,
  stormAreaCorrectionK,
  stormBaseBeta,
  stormParameterA,
  stormSurfaceCoefficientZ,
  stormTravelTimeMin,
  weightedStormCoefficientZ,
  type StormRunoffInput,
} from './storm-runoff'

const rain = {
  q20LpsPerHa: 80,
  exponentN: 0.74,
  rainEventsPerYearMr: 80,
  exponentGamma: 1.82,
  designPeriodYears: 1,
  source: 'synthetic verified climate record',
  verified: true,
}

const ready = (overrides: Partial<StormRunoffInput> = {}): StormRunoffInput => ({
  id: 'C-01',
  rain,
  surfaces: [
    { id: 'roof', kind: 'impervious', areaHa: 2, source: 'synthetic survey', verified: true },
    { id: 'lawn', kind: 'lawn', areaHa: 1, source: 'synthetic survey', verified: true },
  ],
  surfaceConcentrationMin: 10,
  gutterSegments: [],
  pipeSegments: [],
  meanTerrainSlope: 0.005,
  networkSectionCount: 12,
  ...overrides,
})

const rainForA = (parameterA: number, exponentN = rain.exponentN) => ({
  ...rain,
  exponentN,
  q20LpsPerHa: parameterA / 20 ** exponentN,
})

describe('storm runoff by the limit-intensity method', () => {
  it('implements formula 5.10 for A without a recurrence multiplier at P=1', () => {
    expect(stormParameterA(rain)).toBeCloseTo(80 * 20 ** 0.74, 10)
  })

  it('uses both rows of table 5.11 and interpolates between A columns', () => {
    expect(imperviousSurfaceCoefficientZ(300, 0.64)).toBeCloseTo(0.32)
    expect(imperviousSurfaceCoefficientZ(300, 0.65)).toBeCloseTo(0.33)
    expect(imperviousSurfaceCoefficientZ(450, 0.65)).toBeCloseTo(0.305)
    expect(imperviousSurfaceCoefficientZ(1500, 0.65)).toBeCloseTo(0.24)
  })

  it('does not clamp or extrapolate A outside table 5.11', () => {
    expect(() => imperviousSurfaceCoefficientZ(299, 0.65)).toThrow(/300–1500/)
    expect(() => imperviousSurfaceCoefficientZ(1501, 0.65)).toThrow(/300–1500/)

    const result = calculateStormRunoff(ready({
      rain: rainForA(250),
      surfaces: [{ id: 'roof', kind: 'impervious', areaHa: 2, source: 'survey', verified: true }],
    }))
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.blockers.join(' ')).toMatch(/экстраполяция|прижатие/)
  })

  it('allows an explicit verified z override outside table 5.11 and records its source', () => {
    const result = calculateStormRunoff(ready({
      rain: rainForA(250),
      surfaces: [{
        id: 'roof',
        kind: 'impervious',
        areaHa: 2,
        coefficientZ: 0.31,
        source: 'approved project coefficient register',
        verified: true,
      }],
    }))
    expect(result.blockers).toEqual([])
    expect(result.coefficientZMid).toBeCloseTo(0.31)
    expect(result.warnings.join(' ')).toContain('подтверждённый override')
    expect(result.provenance).toContainEqual(expect.objectContaining({
      method: 'verified_override',
      value: 0.31,
      source: 'approved project coefficient register',
    }))
  })

  it('rejects a z override without verification and a source', () => {
    expect(() => stormSurfaceCoefficientZ({
      id: 'roof',
      kind: 'impervious',
      areaHa: 2,
      coefficientZ: 0.31,
      source: '',
      verified: false,
    }, 250, rain.exponentN)).toThrow(/verified=true/)
  })

  it('exposes table 5.11 interpolation through warnings and structured provenance', () => {
    const result = calculateStormRunoff(ready({
      rain: rainForA(450),
      surfaces: [{ id: 'roof', kind: 'impervious', areaHa: 2, source: 'survey', verified: true }],
    }))
    expect(result.blockers).toEqual([])
    expect(result.warnings.join(' ')).toContain('линейной интерполяцией по A')
    const interpolation = result.provenance.find((entry) => entry.method === 'linear_interpolation')
    expect(interpolation).toEqual(expect.objectContaining({
      method: 'linear_interpolation',
      lower: { input: 400, value: 0.31 },
      upper: { input: 500, value: 0.3 },
    }))
    expect(interpolation!.input).toBeCloseTo(450)
  })

  it('marks an exact table 5.11 value without an interpolation warning', () => {
    const result = calculateStormRunoff(ready({
      rain: rainForA(500),
      surfaces: [{ id: 'roof', kind: 'impervious', areaHa: 2, source: 'survey', verified: true }],
    }))
    expect(result.warnings.join(' ')).not.toContain('интерполяцией по A')
    expect(result.provenance).toContainEqual(expect.objectContaining({
      method: 'table_exact',
      input: 500,
      value: 0.3,
    }))
  })

  it('computes z_mid as an area-weighted value', () => {
    const parameterA = stormParameterA(rain)
    const result = weightedStormCoefficientZ(ready().surfaces, parameterA, rain.exponentN)
    const impervious = imperviousSurfaceCoefficientZ(parameterA, rain.exponentN)
    expect(result.areaHa).toBe(3)
    expect(result.coefficientZMid).toBeCloseTo((impervious * 2 + 0.038) / 3, 10)
  })

  it('implements travel-time formulas 5.11-5.13 with their distinct factors', () => {
    expect(stormTravelTimeMin({
      surfaceConcentrationMin: 5,
      gutterSegments: [{ lengthM: 100, velocityMps: 2 }],
      pipeSegments: [{ lengthM: 300, velocityMps: 3 }],
    })).toBeCloseTo(5 + 0.021 * 50 + 0.017 * 100)
  })

  it('applies the table 5.9 area correction and table 5.12 beta', () => {
    expect(stormAreaCorrectionK(499)).toBe(1)
    expect(stormAreaCorrectionK(500)).toBe(0.95)
    expect(stormAreaCorrectionK(1500)).toBeCloseTo(0.875)
    expect(stormBaseBeta(0.4)).toBe(0.8)
    expect(stormBaseBeta(0.55)).toBeCloseTo(0.725)
    expect(stormBaseBeta(0.8)).toBe(0.65)
  })

  it('does not clamp an area above table 5.9 and accepts only an explicit verified K override', () => {
    expect(() => stormAreaCorrectionK(10001)).toThrow(/500–10000/)

    const blocked = calculateStormRunoff(ready({
      surfaces: [{ id: 'basin', kind: 'graded_soil', areaHa: 11000, source: 'survey', verified: true }],
    }))
    expect(blocked.calculatedFlowLps).toBeNull()
    expect(blocked.blockers.join(' ')).toMatch(/экстраполяция|прижатие/)

    const calculated = calculateStormRunoff(ready({
      surfaces: [{ id: 'basin', kind: 'graded_soil', areaHa: 11000, source: 'survey', verified: true }],
      areaCorrectionKOverride: {
        value: 0.5,
        verified: true,
        source: 'approved hydraulic study',
      },
    }))
    expect(calculated.blockers.join(' ')).toContain('свыше 50 га')
    expect(calculated.verified).toBe(false)
    expect(calculated.areaCorrectionK).toBe(0.5)
    expect(calculated.warnings.join(' ')).toContain('override K=0.5')
    expect(calculated.provenance).toContainEqual(expect.objectContaining({
      parameter: 'Коэффициент неравномерности дождя по площади K',
      method: 'verified_override',
      input: 11000,
      value: 0.5,
      source: 'approved hydraulic study',
    }))
  })

  it('exposes table 5.9 interpolation through warnings and provenance bounds', () => {
    const result = calculateStormRunoff(ready({
      surfaces: [{ id: 'basin', kind: 'graded_soil', areaHa: 1500, source: 'survey', verified: true }],
    }))
    expect(result.blockers.join(' ')).toContain('свыше 50 га')
    expect(result.verified).toBe(false)
    expect(result.areaCorrectionK).toBeCloseTo(0.875)
    expect(result.warnings.join(' ')).toContain('K получен линейной интерполяцией')
    expect(result.provenance).toContainEqual(expect.objectContaining({
      method: 'linear_interpolation',
      input: 1500,
      lower: { input: 1000, value: 0.9 },
      upper: { input: 2000, value: 0.85 },
    }))
  })

  it('rejects an unverified area-correction override', () => {
    const result = calculateStormRunoff(ready({
      surfaces: [{ id: 'basin', kind: 'graded_soil', areaHa: 11000, source: 'survey', verified: true }],
      areaCorrectionKOverride: { value: 0.5, verified: false, source: '' },
    }))
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.blockers.join(' ')).toContain('verified=true')
  })

  it('distinguishes normative beta boundaries from actual interpolation', () => {
    const boundary = calculateStormRunoff(ready({
      rain: rainForA(600, 0.8),
      surfaces: [{ id: 'soil', kind: 'graded_soil', areaHa: 2, source: 'survey', verified: true }],
    }))
    expect(boundary.beta).toBe(0.65)
    expect(boundary.warnings.join(' ')).not.toContain('beta получен линейной интерполяцией')
    expect(boundary.provenance).toContainEqual(expect.objectContaining({
      parameter: 'Базовый коэффициент beta',
      method: 'normative_boundary',
      input: 0.8,
      value: 0.65,
    }))

    const interpolated = calculateStormRunoff(ready({
      rain: rainForA(600, 0.55),
      surfaces: [{ id: 'soil', kind: 'graded_soil', areaHa: 2, source: 'survey', verified: true }],
    }))
    expect(interpolated.beta).toBeCloseTo(0.725)
    expect(interpolated.warnings.join(' ')).toContain('beta получен линейной интерполяцией')
    expect(interpolated.provenance).toContainEqual(expect.objectContaining({
      parameter: 'Базовый коэффициент beta',
      method: 'linear_interpolation',
      lower: { input: 0.5, value: 0.75 },
      upper: { input: 0.6, value: 0.7 },
    }))
  })

  it('calculates q_r and q_cal from verified inputs and records traceable refs', () => {
    const result = calculateStormRunoff(ready())
    const expectedA = stormParameterA(rain)
    const expectedZ = weightedStormCoefficientZ(ready().surfaces, expectedA, rain.exponentN).coefficientZMid
    const expectedQr = expectedZ * expectedA ** 1.2 * 3 / 10 ** (1.2 * rain.exponentN - 0.1)
    expect(result.blockers).toEqual([])
    expect(result.rainFlowLps).toBeCloseTo(expectedQr, 8)
    expect(result.calculatedFlowLps).toBeCloseTo(stormBaseBeta(rain.exponentN) * expectedQr, 8)
    expect(result.verified).toBe(true)
    expect(result.refs).toContain('storm.runoff.limitIntensity')
  })

  it('uses the explicit 0.8 correction at exactly five minutes', () => {
    const ten = calculateStormRunoff(ready())
    const five = calculateStormRunoff(ready({ surfaceConcentrationMin: 5 }))
    const durationExponent = 1.2 * rain.exponentN - 0.1
    expect(five.rainFlowLps).toBeCloseTo(ten.rainFlowLps! * 0.8 * (10 / 5) ** durationExponent, 8)
  })

  it('blocks an unspecified short-duration interpolation instead of inventing it', () => {
    const result = calculateStormRunoff(ready({ surfaceConcentrationMin: 6 }))
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.blockers.join(' ')).toContain('t_r < 10')
  })

  it('requires a deliberate 10-15% beta increase in the ambiguous slope band', () => {
    const blocked = calculateStormRunoff(ready({ meanTerrainSlope: 0.02 }))
    expect(blocked.calculatedFlowLps).toBeNull()
    expect(blocked.blockers.join(' ')).toContain('10% до 15%')
    const calculated = calculateStormRunoff(ready({ meanTerrainSlope: 0.02, slopeBetaIncreaseFraction: 0.12 }))
    expect(calculated.beta).toBeCloseTo(stormBaseBeta(rain.exponentN) * 1.12)
  })

  it('blocks unverified climate and surface sources', () => {
    const result = calculateStormRunoff(ready({
      rain: { ...rain, verified: false },
      surfaces: [{ id: 'roof', kind: 'impervious', areaHa: 1, source: '', verified: false }],
    }))
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.blockers).toHaveLength(2)
  })

  it('blocks a catchment over 50 ha until mandatory partial checks are supplied', () => {
    const result = calculateStormRunoff(ready({
      surfaces: [{ id: 'large', kind: 'graded_soil', areaHa: 60, source: 'synthetic survey', verified: true }],
    }))
    expect(result.blockers.join(' ')).toContain('свыше 50 га')
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.verified).toBe(false)
  })

  it('routes an external undeveloped catchment over 1000 ha to the required other method', () => {
    const result = calculateStormRunoff(ready({
      outsideSettlement: true,
      surfaces: [{ id: 'external', kind: 'graded_soil', areaHa: 1200, source: 'synthetic survey', verified: true }],
    }))
    expect(result.calculatedFlowLps).toBeNull()
    expect(result.blockers.join(' ')).toContain('иной нормативный метод')
  })
})

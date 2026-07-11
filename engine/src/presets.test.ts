import { describe, expect, it } from 'vitest'
import { BUILDING_PRESETS, buildingPreset, SOURCE_PRESETS, sourcePreset } from './presets'
import { computeNetworkDemand } from './demand'

describe('presets', () => {
  it('has residential using the global norm and non residential with pending norms', () => {
    const residential = buildingPreset('residential')!
    expect(residential.specificDemandLpd).toBeNull()
    expect(residential.normPending).toBe(false)

    const nonResidential = BUILDING_PRESETS.filter((p) => p.id !== 'residential')
    expect(nonResidential.length).toBe(5)
    for (const preset of nonResidential) {
      expect(preset.specificDemandLpd).toBeGreaterThan(0)
      expect(preset.normPending).toBe(true)
      expect(preset.sourceNote).toContain('СП РК')
    }
  })

  it('provides source presets with a mark and a default head', () => {
    expect(SOURCE_PRESETS).toHaveLength(6)
    expect(sourcePreset('water_tower')?.mark).toBe('ВБ')
    expect(sourcePreset('treatment')?.defaultAvailableHeadM).toBe(45)
  })
})

describe('demand with per building norms', () => {
  it('uses the per unit norm when present', () => {
    // A hospital: 100 beds at 250 L/day = 25 m3/day average.
    const demand = computeNetworkDemand([{ id: 'h', residents: 100, specificDemandLpd: 250 }])
    expect(demand.avgDailyM3).toBeCloseTo(25, 6)
  })

  it('falls back to the global per capita norm for residential', () => {
    const withOverride = computeNetworkDemand([{ id: 'r', residents: 100 }])
    // 100 residents * 200 L/day / 1000 = 20 m3/day.
    expect(withOverride.avgDailyM3).toBeCloseTo(20, 6)
  })

  it('distributes the design flow by daily demand share for a mixed network', () => {
    const demand = computeNetworkDemand([
      { id: 'r', residents: 100 }, // 20 m3/day
      { id: 'h', residents: 100, specificDemandLpd: 250 }, // 25 m3/day
    ])
    const r = demand.buildings.find((b) => b.id === 'r')!
    const h = demand.buildings.find((b) => b.id === 'h')!
    expect(h.designFlowLps).toBeGreaterThan(r.designFlowLps)
    const totalShare = r.designFlowLps + h.designFlowLps
    expect(totalShare).toBeCloseTo(demand.designFlowLps, 6)
  })
})

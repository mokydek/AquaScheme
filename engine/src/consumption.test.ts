import { describe, expect, it } from 'vitest'
import { computeConsumption } from './consumption'
import { NORMATIVE_DEFAULTS } from './norms'
import { computeNetworkDemand } from './demand'

const BUILDINGS = [
  { id: 'b1', residents: 500 },
  { id: 'b2', residents: 300 },
]

describe('computeConsumption', () => {
  it('drainage flow equals the domestic water design flow (no irrigation, no fire)', () => {
    const c = computeConsumption(BUILDINGS)
    const water = computeNetworkDemand(BUILDINGS)
    expect(c.drainageFlowLps).toBe(water.designFlowLps)
    expect(c.drainageDailyM3).toBe(water.maxDailyM3)
    // Fire flow is a water reserve, not a discharge — excluded from drainage.
    expect(c.drainageFlowLps).toBeLessThan(water.designFlowWithFireLps)
  })

  it('is the single source of truth: same buildings give the same water demand', () => {
    const c = computeConsumption(BUILDINGS)
    expect(c.water.totalResidents).toBe(800)
    expect(c.water.designFlowLps).toBeGreaterThan(0)
  })

  it('is zero for an empty district', () => {
    const c = computeConsumption([])
    expect(c.drainageFlowLps).toBe(0)
    expect(c.drainageDailyM3).toBe(0)
  })
})

describe('расход стока по коэффициенту неравномерности', () => {
  const buildings = Array.from({ length: 40 }, (_, index) => ({
    id: `B-${index + 1}`, floors: 5, residents: 60,
  }))

  it('считается рядом с основным, не подменяя его', () => {
    const result = computeConsumption(buildings)
    // Основной расход остаётся тем же, что и у водопотребления.
    expect(result.drainageFlowLps).toBe(result.water.designFlowLps)
    // И рядом появляется величина по таблице 5.13.
    expect(result.drainageMeanFlowLps).toBeGreaterThan(0)
    expect(result.kGenMax).toBeGreaterThan(1)
    expect(result.drainageFlowByKGenLps).toBeCloseTo(
      result.drainageMeanFlowLps * result.kGenMax, 1,
    )
  })

  it('коэффициент падает с ростом среднего расхода', () => {
    const small = computeConsumption(buildings.slice(0, 4))
    const large = computeConsumption([
      ...buildings,
      ...Array.from({ length: 400 }, (_, index) => ({ id: `C-${index}`, floors: 9, residents: 120 })),
    ])
    expect(large.drainageMeanFlowLps).toBeGreaterThan(small.drainageMeanFlowLps)
    expect(large.kGenMax).toBeLessThan(small.kGenMax)
  })

  it('на пустом списке ничего не выдумывается', () => {
    const result = computeConsumption([])
    expect(result.drainageMeanFlowLps).toBe(0)
    expect(result.drainageFlowByKGenLps).toBe(0)
  })
})

describe('выбор метода расчёта расхода стока', () => {
  const buildings = Array.from({ length: 200 }, (_, index) => ({
    id: `B-${index + 1}`, floors: 5, residents: 100,
  }))

  it('по умолчанию поведение прежнее', () => {
    const result = computeConsumption(buildings)
    expect(result.drainageFlowMethod).toBe('water-demand')
    expect(result.drainageFlowLps).toBe(result.drainageFlowByWaterDemandLps)
  })

  it('выбранный метод меняет именно расчётный расход', () => {
    const byKGen = computeConsumption(buildings, {
      ...NORMATIVE_DEFAULTS, drainageFlowMethod: 'kgen-table',
    })
    expect(byKGen.drainageFlowMethod).toBe('kgen-table')
    expect(byKGen.drainageFlowLps).toBe(byKGen.drainageFlowByKGenLps)
    // Оба значения считаются при любом выборе: расхождение видно всегда.
    expect(byKGen.drainageFlowByWaterDemandLps).toBeGreaterThan(0)
    expect(byKGen.drainageFlowByWaterDemandLps).not.toBe(byKGen.drainageFlowByKGenLps)
  })

  it('на этом размере таблица 5.13 даёт больший расход, чем водопотребление', () => {
    // 20 000 жителей: занижение диаметра при выборе по водопотреблению — не
    // умозрительный риск, а измеренное расхождение.
    const result = computeConsumption(buildings)
    expect(result.drainageFlowByKGenLps).toBeGreaterThan(result.drainageFlowByWaterDemandLps)
  })
})

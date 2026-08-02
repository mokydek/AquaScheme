import { describe, expect, it } from 'vitest'
import { selectPumps, standbyPumpCount, type PumpCatalogueItem } from './pumps'

const catalogue: PumpCatalogueItem[] = [
  { designation: 'СМ 100-65-200', flowLps: 30, headM: 20, powerKw: 11 },
  { designation: 'СМ 150-125-315', flowLps: 60, headM: 32, powerKw: 30 },
  { designation: 'СМ 200-150-400', flowLps: 120, headM: 45, powerKw: 75 },
  { designation: 'Погружной ГНОМ', flowLps: 60, headM: 34, powerKw: 30, submersible: true },
]

describe('число резервных насосов, таблица 8.2', () => {
  it('бытовые сточные воды по категориям надёжности', () => {
    expect(standbyPumpCount(1, 'first', 'domestic').value).toEqual({ standby: 2, spareOnStore: 0 })
    expect(standbyPumpCount(1, 'second', 'domestic').value).toEqual({ standby: 1, spareOnStore: 0 })
    expect(standbyPumpCount(2, 'first', 'domestic').value).toEqual({ standby: 2, spareOnStore: 0 })
    expect(standbyPumpCount(2, 'third', 'domestic').value).toEqual({ standby: 1, spareOnStore: 0 })
    // «3 и более»: третья категория — 1 резервный и 1 на складе.
    expect(standbyPumpCount(5, 'first', 'domestic').value).toEqual({ standby: 2, spareOnStore: 0 })
    expect(standbyPumpCount(5, 'second', 'domestic').value).toEqual({ standby: 2, spareOnStore: 0 })
    expect(standbyPumpCount(5, 'third', 'domestic').value).toEqual({ standby: 1, spareOnStore: 1 })
  })

  it('агрессивные сточные воды не зависят от категории', () => {
    expect(standbyPumpCount(1, 'third', 'aggressive').value).toEqual({ standby: 1, spareOnStore: 1 })
    expect(standbyPumpCount(3, 'first', 'aggressive').value).toEqual({ standby: 2, spareOnStore: 0 })
    expect(standbyPumpCount(4, 'second', 'aggressive').value).toEqual({ standby: 3, spareOnStore: 0 })
    // «5 и более — не менее 50%».
    expect(standbyPumpCount(6, 'first', 'aggressive').value.standby).toBe(3)
    expect(standbyPumpCount(7, 'first', 'aggressive').value.standby).toBe(4)
  })

  it('дождевая станция обходится без резерва, пока возможен аварийный сброс', () => {
    const usual = standbyPumpCount(3, 'first', 'storm')
    expect(usual.value).toEqual({ standby: 0, spareOnStore: 0 })
    expect(usual.note).toContain('примечание 1')
    // Если сброс невозможен, станция считается как обычная.
    expect(standbyPumpCount(3, 'first', 'storm', { stormOverflowImpossible: true }).value.standby).toBe(2)
  })

  it('погружные агрегаты по примечанию 3', () => {
    expect(standbyPumpCount(6, 'first', 'domestic', { submersible: true }).value)
      .toEqual({ standby: 1, spareOnStore: 1 })
    expect(standbyPumpCount(6, 'second', 'domestic', { submersible: true }).value)
      .toEqual({ standby: 1, spareOnStore: 0 })
  })
})

describe('подбор агрегата', () => {
  it('берёт ближайший по напору из подходящих, а не самый мощный', () => {
    const result = selectPumps({
      designFlowLps: 55, requiredHeadM: 30,
      category: 'second', effluent: 'domestic', catalogue,
    })
    expect(result.ok).toBe(true)
    expect(result.pump?.designation).toBe('СМ 150-125-315')
    expect(result.workingCount).toBe(1)
    expect(result.standbyCount).toBe(1)
    expect(result.totalInstalled).toBe(2)
  })

  it('делит расход между рабочими агрегатами', () => {
    const result = selectPumps({
      designFlowLps: 110, requiredHeadM: 30, workingCount: 2,
      category: 'second', effluent: 'domestic', catalogue,
    })
    expect(result.perPumpFlowLps).toBe(55)
    expect(result.pump?.designation).toBe('СМ 150-125-315')
    expect(result.totalInstalled).toBe(3)
  })

  it('не подбирает агрегат без каталога проекта', () => {
    const result = selectPumps({
      designFlowLps: 55, requiredHeadM: 30,
      category: 'second', effluent: 'domestic', catalogue: [],
    })
    expect(result.ok).toBe(false)
    expect(result.pump).toBeNull()
    expect(result.blockers.join(' ')).toContain('Каталог насосов не загружен')
  })

  it('говорит, что подходящего агрегата нет, вместо выбора недостаточного', () => {
    const result = selectPumps({
      designFlowLps: 300, requiredHeadM: 80,
      category: 'first', effluent: 'domestic', catalogue,
    })
    expect(result.ok).toBe(false)
    expect(result.pump).toBeNull()
    expect(result.blockers.join(' ')).toMatch(/нет агрегата на 300\.0 л\/с при напоре 80\.0 м/)
  })

  it('требует расчёта напорного участка прежде подбора', () => {
    const result = selectPumps({
      designFlowLps: 55, requiredHeadM: 0,
      category: 'second', effluent: 'domestic', catalogue,
    })
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toContain('расчёт напорного участка')
  })

  it('для ливневой станции ставит только рабочие агрегаты', () => {
    const result = selectPumps({
      designFlowLps: 110, requiredHeadM: 30, workingCount: 2,
      category: 'first', effluent: 'storm', catalogue,
    })
    expect(result.standbyCount).toBe(0)
    expect(result.totalInstalled).toBe(2)
    expect(result.notes.join(' ')).toContain('примечание 1')
  })
})

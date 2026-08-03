import { describe, expect, it } from 'vitest'
import { solvePressureMain } from '@aquascheme/engine'
import type { PressureMainResult } from '@aquascheme/engine'
import { pumpSelectionFor } from './pumpSelection'
import type { PumpCatalogContent } from './PumpCatalogSection'

/** Напорный участок 1200 м Ø400 на 69 л/с с подъёмом 12 м. */
const pressure = (): PressureMainResult => solvePressureMain({
  pipes: [{ id: 'НВ-1', lengthM: 1200, diameterMm: 400, flowLps: 69 }],
  inletElevationM: 100,
  outletElevationM: 112,
  availablePumpHeadM: 25,
})

const catalog: PumpCatalogContent = {
  category: 'first',
  effluent: 'domestic',
  entries: [
    { designation: 'мал', flowLps: 20, headM: 40, source: 'каталог' },
    { designation: 'впору', flowLps: 70, headM: 18, powerKw: 22, source: 'каталог, лист 12' },
    { designation: 'избыточный', flowLps: 70, headM: 60, source: 'каталог' },
  ],
}

describe('подбор насосов ЛНС', () => {
  it('считает требуемый напор больше геометрического подъёма', () => {
    // Подставить подъём вместо требуемого напора — занизить агрегат. Проверяем,
    // что подбор опирается именно на расчёт.
    const result = pressure()
    expect(result.staticHeadM).toBeCloseTo(12, 2)
    expect(result.requiredPumpHeadM).toBeGreaterThan(result.staticHeadM)
    expect(result.frictionHeadM).toBeGreaterThan(0)
  })

  it('берёт ближайший подходящий агрегат, а не самый мощный', () => {
    const outcome = pumpSelectionFor(pressure(), 69, catalog)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.selection.pump?.designation).toBe('впору')
    expect(outcome.selection.pump?.source).toBe('каталог, лист 12')
    // I категория, один рабочий — таблица 8.2 требует резерв.
    expect(outcome.selection.standbyCount).toBeGreaterThan(0)
    expect(outcome.selection.totalInstalled).toBe(
      outcome.selection.workingCount + outcome.selection.standbyCount)
  })

  it('без каталога, категории или характера стоков ничего не подставляет', () => {
    const bare = pumpSelectionFor(pressure(), 69, {})
    expect(bare.ok).toBe(false)
    if (bare.ok) return
    expect(bare.missing).toEqual([
      'каталог насосов не загружен',
      'не выбрана категория надёжности ЛНС',
      'не выбран характер сточных вод',
    ])

    const noCategory = pumpSelectionFor(pressure(), 69, { ...catalog, category: undefined })
    expect(noCategory.ok).toBe(false)
    if (noCategory.ok) return
    expect(noCategory.missing).toEqual(['не выбрана категория надёжности ЛНС'])
  })

  it('незавершённый напорный расчёт подбор не запускает', () => {
    // Без диаметра требуемый напор не считается: подбирать не по чему.
    const blocked = solvePressureMain({
      pipes: [{ id: 'НВ-1', lengthM: 1200, diameterMm: 0, flowLps: 69 }],
      inletElevationM: 100,
      outletElevationM: 112,
      availablePumpHeadM: 25,
    })
    const outcome = pumpSelectionFor(blocked, 69, catalog)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.missing).toContain('расчёт напорного участка не завершён')
  })

  it('деление притока между рабочими агрегатами меняет требуемую подачу', () => {
    const outcome = pumpSelectionFor(pressure(), 69, { ...catalog, workingCount: 4 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.selection.perPumpFlowLps).toBeCloseTo(17.25, 2)
    // На 17 л/с проходит и малый агрегат, а его напор ближе к требуемому.
    expect(outcome.selection.pump?.designation).toBe('впору')
  })

  it('нехватку агрегата в каталоге называет, а не подбирает молча', () => {
    const outcome = pumpSelectionFor(pressure(), 69, {
      ...catalog,
      entries: [{ designation: 'слабый', flowLps: 70, headM: 5, source: 'каталог' }],
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.selection.ok).toBe(false)
    expect(outcome.selection.pump).toBeNull()
    expect(outcome.selection.blockers.join(' ')).toMatch(/нет агрегата/)
  })

  it('дождевая станция без запрета аварийного сброса резерва не требует', () => {
    const outcome = pumpSelectionFor(pressure(), 69, { ...catalog, effluent: 'storm' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.selection.standbyCount).toBe(0)
    expect(outcome.selection.notes.join(' ')).toMatch(/примечание 1/)
  })
})

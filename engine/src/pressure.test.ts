import { describe, expect, it } from 'vitest'
import { solvePressureMain } from './pressure'

/**
 * Шероховатость и коэффициент местных потерь ЗАДАЮТСЯ В КАЖДОМ ТЕСТЕ.
 *
 * Раньше их можно было не задавать: решатель подставлял 0,3 мм и 1,5 скоростных
 * напора сам. Проверки от этого читались обманчиво — «расчёт выполнен» означало
 * «выполнен на двух выдуманных величинах». Теперь отсутствие любой из них —
 * стоп-фактор, и тесты называют величины прямо.
 */
const steel = { roughnessMm: 0.1 }

describe('solvePressureMain', () => {
  it('keeps pressure hydraulics separate and accounts for parallel barrels', () => {
    const single = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 1000, diameterMm: 800, flowLps: 600, ...steel }],
      inletElevationM: 340,
      outletElevationM: 345,
      availablePumpHeadM: 20,
      localLossCoefficient: 1.5,
    })
    const parallel = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 1000, diameterMm: 800, flowLps: 600, parallelCount: 2, ...steel }],
      inletElevationM: 340,
      outletElevationM: 345,
      availablePumpHeadM: 20,
      localLossCoefficient: 1.5,
    })
    expect(single.kind).toBe('pressure')
    expect(single.status).toBe('calculated')
    expect(parallel.pipes[0].velocityMs).toBeLessThan(single.pipes[0].velocityMs)
    expect(parallel.frictionHeadM).toBeLessThan(single.frictionHeadM)
  })

  it('blocks a final pressure result when pump duty is absent', () => {
    const result = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 50, diameterMm: 500, flowLps: 100, ...steel }],
      inletElevationM: 340,
      outletElevationM: 341,
      localLossCoefficient: 1.5,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.join(' ')).toContain('насоса')
  })

  it('шероховатость без величины — стоп-фактор, а не типовые 0,3 мм', () => {
    // Величина уходит в коэффициент трения, оттуда в потери напора, в требуемый
    // напор насоса и в подбор оборудования: ошибка вдвое в ней — ошибка вдвое в
    // напоре, и заметить её на экране было нечем.
    const result = solvePressureMain({
      pipes: [{ id: 'НП-1', lengthM: 300, diameterMm: 400, flowLps: 120 }],
      inletElevationM: 0,
      outletElevationM: 8,
      availablePumpHeadM: 25,
      localLossCoefficient: 1.5,
    })
    expect(result.status).toBe('blocked')
    expect(result.requiredPumpHeadM).toBeNull()
    const text = result.blockers.join(' ')
    expect(text).toContain('НП-1')
    expect(text).toContain('шероховатость')
    // Стоп-фактор называет раздел, где величину принимают.
    expect(text).toContain('Каталог труб и материалов')
  })

  it('коэффициент местных потерь пока подставляется — подстановка зафиксирована', () => {
    // ЭТО НЕ ОДОБРЕНИЕ ПОДСТАНОВКИ, а фиксация незакрытого места. Заменить её
    // стоп-фактором сейчас нельзя: поля для ввода нет ни на одном экране, и
    // стоп получился бы без пути — ровно то, что запрещает правило
    // достижимости. Тест держит поведение до появления поля и упадёт, если
    // подстановка изменится молча.
    const withCoefficient = solvePressureMain({
      pipes: [{ id: 'НП-1', lengthM: 300, diameterMm: 400, flowLps: 120, ...steel }],
      inletElevationM: 0, outletElevationM: 8, availablePumpHeadM: 25,
      localLossCoefficient: 1.5,
    })
    const withoutCoefficient = solvePressureMain({
      pipes: [{ id: 'НП-1', lengthM: 300, diameterMm: 400, flowLps: 120, ...steel }],
      inletElevationM: 0, outletElevationM: 8, availablePumpHeadM: 25,
    })
    expect(withoutCoefficient.requiredPumpHeadM).toBe(withCoefficient.requiredPumpHeadM)
  })

  it('нулевая шероховатость не проходит как заданная', () => {
    // Ноль — законная запись «гладкая труба» только в учебнике; в проекте это
    // незаполненное поле, и различать их обязана программа, а не инженер.
    const result = solvePressureMain({
      pipes: [{ id: 'НП-1', lengthM: 300, diameterMm: 400, flowLps: 120, roughnessMm: 0 }],
      inletElevationM: 0,
      outletElevationM: 8,
      availablePumpHeadM: 25,
      localLossCoefficient: 1.5,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.join(' ')).toContain('шероховатость')
  })
})

describe('отметки не подставляются нулём', () => {
  /**
   * `SituationSchemeSection` передавал сюда `lns?.groundElevation ?? 0`. Узел
   * без отметки давал нулевой геодезический перепад, требуемый напор выходил
   * заниженным, а состояние — «рассчитано». На объекте с абсолютными отметками
   * около 685 м это не мелочь, и ноль был неотличим от настоящей отметки
   * 0,00 м: подстановку нельзя было опознать даже по значению.
   */
  const pipe = {
    id: 'P1', lengthM: 100, diameterMm: 200, flowLps: 40, roughnessMm: 0.1,
  }

  it('без отметки ЛНС напор не считается, и сказано почему', () => {
    const result = solvePressureMain({
      pipes: [pipe], inletElevationM: null, outletElevationM: 690, availablePumpHeadM: 30,
    })
    expect(result.status).toBe('blocked')
    expect(result.staticHeadM).toBeNull()
    expect(result.requiredPumpHeadM).toBeNull()
    expect(result.blockers.join(' ')).toContain('отметка земли у ЛНС')
  })

  it('без отметки выпуска — то же самое', () => {
    const result = solvePressureMain({
      pipes: [pipe], inletElevationM: 685, outletElevationM: null, availablePumpHeadM: 30,
    })
    expect(result.status).toBe('blocked')
    expect(result.staticHeadM).toBeNull()
    expect(result.blockers.join(' ')).toContain('отметка земли у выпуска')
  })

  it('обе отметки заданы — считается как раньше', () => {
    const result = solvePressureMain({
      pipes: [pipe], inletElevationM: 685, outletElevationM: 690, availablePumpHeadM: 30,
    })
    expect(result.staticHeadM).toBeCloseTo(5, 3)
    expect(result.status).toBe('calculated')
  })

  it('настоящие отметки объекта не выдаются за ноль', () => {
    // 685 и 690 против 0 и 0: разница в требуемом напоре — все пять метров
    // подъёма, которые подстановка съедала молча.
    const real = solvePressureMain({
      pipes: [pipe], inletElevationM: 685, outletElevationM: 690, availablePumpHeadM: 30,
    })
    const zeroed = solvePressureMain({
      pipes: [pipe], inletElevationM: 0, outletElevationM: 0, availablePumpHeadM: 30,
    })
    expect((real.requiredPumpHeadM ?? 0) - (zeroed.requiredPumpHeadM ?? 0)).toBeCloseTo(5, 3)
  })
})

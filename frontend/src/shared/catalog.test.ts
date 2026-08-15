import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { solveGravityNetwork } from '@aquascheme/engine'
import { conditionsDiameterSeries, resolveGravityCatalog } from './catalog'
import type { TechnicalConditions } from './technicalConditions'

/**
 * Подтверждённые технические условия по ул. Станкевича.
 *
 * Так они выглядят ПОСЛЕ подтверждения владельцем на экране разбора ТУ.
 * `origin: 'ocr'` — не мелочь: у ТУ_05-3-2723 нет текстового слоя вовсе
 * (выгрузка страниц пуста), величина прочитана распознаванием, и в аудите она
 * обязана оставаться отличимой от цифрового документа.
 */
const TU: TechnicalConditions = {
  designDiameterMm: {
    value: 450,
    origin: 'ocr',
    source: 'ТУ_05-3-2723 (1).pdf, стр. 2 (распознано)',
    page: 2,
    quote: 'п. 25. Проложить коллектор Д=450 мм',
  },
}

describe('resolveGravityCatalog', () => {
  it('uses the built-in series only when no custom catalog is selected', () => {
    expect(resolveGravityCatalog(null, undefined)).toEqual({ ready: true })
  })

  it('blocks the solver while a selected catalog is loading', () => {
    const result = resolveGravityCatalog('catalog-1', undefined)
    expect(result.ready).toBe(false)
    expect(result.blocker).toContain('ожидает загрузку')
  })

  it('blocks empty and failed custom catalogs instead of producing diameter zero', () => {
    expect(resolveGravityCatalog('catalog-1', []).ready).toBe(false)
    const failed = resolveGravityCatalog('catalog-1', undefined, 'HTTP 400')
    expect(failed.ready).toBe(false)
    expect(failed.blocker).toContain('HTTP 400')
  })

  it('normalizes positive catalog diameters before hydraulic sizing', () => {
    expect(resolveGravityCatalog('catalog-1', [1200, 800, 1200, 0, Number.NaN])).toEqual({
      ready: true,
      allowedDiametersMm: [800, 1200],
    })
  })

  it('подтверждённый ряд по ТУ доходит до расчёта без второго ввода', () => {
    // До этого захода подтверждённый Д=450 ложился в `technical_conditions` и
    // на этом останавливался: ряд шёл только из каталога, и владельцу
    // приходилось задавать 450 второй раз, загружая каталог.
    const resolved = resolveGravityCatalog(null, undefined, null, TU)
    expect(resolved).toEqual({ ready: true, allowedDiametersMm: [450], fromConditions: true })
  })

  it('перечень ТУ главнее одиночного диаметра', () => {
    expect(conditionsDiameterSeries({
      ...TU,
      allowedDiametersMm: { value: [400, 450, 500], origin: 'stated', source: 'ТУ п. 25' },
    })).toEqual([400, 450, 500])
    expect(conditionsDiameterSeries(undefined)).toBeUndefined()
    expect(conditionsDiameterSeries({})).toBeUndefined()
  })

  it('ряд ТУ и каталог пересекаются, а не заменяют друг друга', () => {
    const both = resolveGravityCatalog('catalog-1', [300, 450, 600], null, {
      allowedDiametersMm: { value: [450, 600, 800], origin: 'stated', source: 'ТУ п. 25' },
    })
    expect(both).toEqual({ ready: true, allowedDiametersMm: [450, 600], fromConditions: true })
  })

  it('пустое пересечение — стоп с названной причиной, а не тихий откат', () => {
    // Молчаливый выбор одной из сторон означал бы либо нарушение ТУ, либо
    // применение трубы, которой в каталоге нет.
    const clash = resolveGravityCatalog('catalog-1', [300, 350], null, TU)
    expect(clash.ready).toBe(false)
    expect(clash.blocker).toContain('Ø450')
    expect(clash.blocker).toContain('не пересекаются')
    expect(clash.allowedDiametersMm).toBeUndefined()
  })
})

describe('сквозной путь ТУ на реконструкции без притока', () => {
  /** Две камеры цепочки — ровно та форма, что даёт съёмка Станкевича. */
  const network = {
    nodes: [
      { id: 'К-1', x: 0, y: 0, groundElevation: 100, kind: 'manhole' as const },
      { id: 'К-2', x: 100, y: 0, groundElevation: 99.5, kind: 'lns_inlet' as const },
    ],
    pipes: [
      { id: 'p1', fromNode: 'К-1', toNode: 'К-2', lengthM: 100, kind: 'main' as const },
    ],
  }
  const solve = (conditions?: TechnicalConditions) => {
    const resolved = resolveGravityCatalog(null, undefined, null, conditions)
    return solveGravityNetwork({
      network: network as never,
      buildingFlowLps: new Map(),
      system: 'sewer',
      freezingDepthM: 1.5,
      allowedDiametersMm: resolved.allowedDiametersMm,
      diametersFromConditions: resolved.fromConditions === true,
    })
  }

  it('после подтверждения ТУ расчёт объявляет «Принят Ø450 (ряд по ТУ)»', () => {
    const pipe = solve(TU).pipes[0]
    expect(pipe.diameterMm).toBe(450)
    const issue = pipe.issues.find((item) => item.code === 'adoptedFromConditions')
    expect(issue?.message).toContain('Принят Ø450 (ряд по ТУ)')
    // Расхода по-прежнему нет, и об этом сказано — но «не подобран» ушло:
    // подбирать нечего, диаметр назван договором.
    expect(issue?.message).toContain('Расчётного расхода нет')
    expect(pipe.issues.some((item) => item.code === 'noDesignFlow')).toBe(false)
  })

  it('без ТУ остаётся честное «принят наименьший из ряда»', () => {
    const pipe = solve(undefined).pipes[0]
    expect(pipe.issues.some((item) => item.code === 'noDesignFlow')).toBe(true)
    expect(pipe.issues.some((item) => item.code === 'adoptedFromConditions')).toBe(false)
  })

  it('запреты, висящие на `noDesignFlow`, к диаметру по ТУ не применяются', () => {
    // От `noDesignFlow` вниз по цепочке зависят два запрета: сверка с
    // генпланом объявляется невыполнимой, а осуществимость самотёка —
    // неоценённой. Диаметр по ТУ — исходное данное, и оба запрета для него
    // неверны: сравнивать Ø450 с генпланом осмысленно.
    const withTu = solve(TU).pipes
      .some((pipe) => pipe.issues.some((item) => item.code === 'noDesignFlow'))
    expect(withTu).toBe(false)
  })
})

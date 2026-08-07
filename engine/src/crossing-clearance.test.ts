import { describe, expect, it } from 'vitest'
import { clearanceNote, crossingClearance, crownElevationM } from './crossing-clearance'

describe('верх проектной трубы', () => {
  it('отстоит от лотка на диаметр', () => {
    expect(crownElevationM(683.23, 450)).toBeCloseTo(683.68, 6)
  })
})

describe('вертикальный просвет в пересечении', () => {
  const design = { designInvertElevationM: 683.0, designDiameterMm: 450 }

  it('сеть выше трубы: просвет от верха, а не от лотка', () => {
    const result = crossingClearance({ existingElevationM: 685.0, ...design })
    expect(result).toEqual({ side: 'above', clearanceM: 1.55, measuredToLabel: true })
  })

  it('сеть ниже трубы: просвет от лотка вниз, число положительное', () => {
    const result = crossingClearance({ existingElevationM: 682.6, ...design })
    expect(result).toEqual({ side: 'below', clearanceM: 0.4, measuredToLabel: true })
  })

  it('сеть между лотком и верхом: заход в габарит, число отрицательное', () => {
    const result = crossingClearance({ existingElevationM: 683.1, ...design })
    expect(result?.side).toBe('within')
    expect(result?.clearanceM).toBeLessThan(0)
    // Заход считается до ближней поверхности: 683.10 − 683.00 = 0.10.
    expect(result?.clearanceM).toBeCloseTo(-0.1, 6)
  })

  it('без диаметра не считается вовсе', () => {
    expect(crossingClearance({ existingElevationM: 685, designInvertElevationM: 683 })).toBeNull()
    expect(crossingClearance({ existingElevationM: 685, designInvertElevationM: 683, designDiameterMm: 0 }))
      .toBeNull()
  })

  it('без снятой отметки не считается', () => {
    expect(crossingClearance(design)).toBeNull()
  })

  it('на границе габарита просвет ровно ноль, а не отрицателен', () => {
    const top = crossingClearance({ existingElevationM: 683.45, ...design })
    expect(top).toEqual({ side: 'above', clearanceM: 0, measuredToLabel: true })
    const bottom = crossingClearance({ existingElevationM: 683.0, ...design })
    expect(bottom).toEqual({ side: 'below', clearanceM: 0, measuredToLabel: true })
  })
})

describe('пояснение к просвету', () => {
  it('называет сторону и оговаривает, до чего отсчитано', () => {
    const note = clearanceNote({ side: 'above', clearanceM: 1.55, measuredToLabel: true })
    expect(note).toContain('над верхом трубы')
    expect(note).toContain('диаметр пересекаемой сети в съёмке не подписан')
  })

  it('заход в габарит называется заходом, а не просветом', () => {
    const note = clearanceNote({ side: 'within', clearanceM: -0.1, measuredToLabel: true })
    expect(note).toContain('заходит в габарит')
    expect(note).not.toContain('просвет')
  })
})

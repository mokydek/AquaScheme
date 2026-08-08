import { describe, expect, it } from 'vitest'
import { measureRoadWidths } from './road-width'

/** Трасса идёт с юга на север через x = 50. */
const route = [{ x: 50, y: -100 }, { x: 50, y: 100 }]

const edge = (id: string, y: number, layer = 'SIT_LДОРОГИ') => ({
  id, layer, points: [{ x: -200, y }, { x: 200, y }],
})

describe('ширина проезжей части по съёмке', () => {
  it('две кромки дают ширину между ними', () => {
    const result = measureRoadWidths(route, [edge('north', 7), edge('south', 0)])
    expect(result.measurements).toHaveLength(1)
    expect(result.measurements[0].widthM).toBeCloseTo(7, 2)
    expect(result.measurements[0].layers).toContain('SIT_LДОРОГИ')
  })

  it('одна линия шириной не считается', () => {
    const result = measureRoadWidths(route, [edge('only', 0)])
    expect(result.measurements).toEqual([])
    expect(result.reason).toContain('Одна линия шириной не считается')
  })

  it('дорожных линий нет вовсе — честная причина, а не ноль', () => {
    const result = measureRoadWidths(route, [])
    expect(result.measurements).toEqual([])
    expect(result.reason).toContain('нет')
  })

  it('кромки под углом к трассе дают ширину ПОПЕРЁК, а не хорду', () => {
    // Кромки идут под 30° к оси X; расстояние между ними по перпендикуляру 7 м.
    const angle = (Math.PI * 30) / 180
    const shift = { x: -Math.sin(angle) * 7, y: Math.cos(angle) * 7 }
    const line = (id: string, dx: number, dy: number) => ({
      id,
      layer: 'SIT_LДОРОГИ',
      points: [
        { x: -300 * Math.cos(angle) + dx, y: -300 * Math.sin(angle) + dy },
        { x: 300 * Math.cos(angle) + dx, y: 300 * Math.sin(angle) + dy },
      ],
    })
    const result = measureRoadWidths(
      [{ x: 0, y: -200 }, { x: 0, y: 200 }],
      [line('a', 0, 0), line('b', shift.x, shift.y)],
    )
    expect(result.measurements).toHaveLength(1)
    // Хорда вдоль трассы была бы 7 / cos(30°) ≈ 8.08 — заметно больше.
    expect(result.measurements[0].widthM).toBeCloseTo(7, 1)
    expect(result.measurements[0].widthM).toBeLessThan(7.5)
  })

  it('пересекающая улица кромкой той же дороги не считается', () => {
    const crossStreet = { id: 'cross', layer: 'SIT_LДОРОГИ', points: [{ x: 40, y: -50 }, { x: 60, y: 50 }] }
    const result = measureRoadWidths(route, [edge('south', 0), crossStreet])
    // Единственная другая линия идёт поперёк — параллельной кромки нет.
    expect(result.measurements).toEqual([])
  })

  it('берётся ближайшая кромка, а не первая попавшаяся', () => {
    const result = measureRoadWidths(route, [edge('south', 0), edge('far', 40), edge('near', 6)])
    expect(result.measurements[0].widthM).toBeCloseTo(6, 2)
  })

  it('измерение несёт пикет перехода', () => {
    const result = measureRoadWidths(route, [edge('south', 0), edge('north', 7)])
    // Трасса начинается в y = −100, кромка на y = 0 → 100 м по трассе.
    expect(result.measurements[0].stationM).toBeCloseTo(100, 1)
  })
})

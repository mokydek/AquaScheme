import { describe, expect, it } from 'vitest'
import { buildSewerSpecification } from './sewerspec'
import { AGSK_SECTIONS } from './agsk'
import { findRoadCrossings } from './structures'
import type { SewerSchedule } from './gravity'

const SCHEDULE: SewerSchedule = {
  manholes: Array.from({ length: 3 }, (_, i) => ({
    label: `КК-${i + 1}`,
    picket: `ПК${i}`,
    depthMm: 3000,
    pipeDiameterMm: 2000,
  })),
  pipes: [
    { designation: 'по ГОСТ', diameterMm: 2000, lengthM: 1500.4, agskCode: '241-7' },
    { designation: 'по ГОСТ', diameterMm: 1200, lengthM: 200, agskCode: '241-7' },
  ],
  totalPipeLengthM: 1700.4,
}

describe('buildSewerSpecification', () => {
  it('lists pipes by diameter with AGSK section codes, manholes and grilles', () => {
    const items = buildSewerSpecification({ schedule: SCHEDULE })
    const names = items.map((i) => i.name)
    expect(items[0].spec).toBe('Ду1200') // sorted by diameter
    expect(items[0].code).toBe('241-7')
    expect(names.find((n) => n.includes('Колодец'))).toBeTruthy()
    const grille = items.find((i) => i.name.includes('Решётка'))
    expect(grille?.quantity).toBe(3)
    expect(grille?.code).toBe(AGSK_SECTIONS.drainageProducts.code)
    // Positions are numbered sequentially from 1.
    expect(items.map((i) => i.pos)).toEqual(items.map((_, idx) => idx + 1))
  })

  it('adds casings per crossing, the lift station and the groundwater set', () => {
    const crossings = findRoadCrossings(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ id: 'шоссе', points: [{ x: 50, y: -5 }, { x: 50, y: 5 }], widthM: 30 }],
    )
    const items = buildSewerSpecification({
      schedule: SCHEDULE,
      crossings,
      liftStation: true,
      highGroundwater: true,
    })
    const casing = items.find((i) => i.name.includes('Футляр'))
    expect(casing?.quantity).toBe(40)
    expect(casing?.spec).toBe('шоссе')
    expect(items.find((i) => i.name.includes('Насосная станция'))?.quantity).toBe(1)
    expect(items.find((i) => i.name.includes('обмазочная'))?.quantity).toBe(1701)
    expect(items.find((i) => i.name.includes('проникающая'))?.quantity).toBe(3)
  })

  it('omits optional structures when their conditions are absent', () => {
    const items = buildSewerSpecification({ schedule: SCHEDULE })
    expect(items.some((i) => i.name.includes('Футляр'))).toBe(false)
    expect(items.some((i) => i.name.includes('Насосная'))).toBe(false)
    expect(items.some((i) => i.name.includes('Гидроизоляция'))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { Borehole } from './geology'
import { geologyCoverageAt, summarizeRouteCoverage } from './geocoverage'

const hole = (label: string, x: number, y: number): Borehole => ({
  label, x, y, layers: [{ topDepthM: 0, bottomDepthM: 6, soilName: 'суглинок' }], water: {},
})

/** Четыре скважины по углам квадрата 100 × 100. */
const square = [hole('1', 0, 0), hole('2', 100, 0), hole('3', 100, 100), hole('4', 0, 100)]

describe('покрытие точки скважинами', () => {
  it('скважина в самой точке — измерено', () => {
    const coverage = geologyCoverageAt(square, 0, 0, 50)
    expect(coverage.confidence).toBe('measured')
    expect(coverage.nearestDistanceM).toBe(0)
  })

  it('точка внутри контура и в допуске — интерполяция', () => {
    const coverage = geologyCoverageAt(square, 50, 50, 100)
    expect(coverage.confidence).toBe('interpolated')
    expect(coverage.boreholesInRange).toBe(4)
    expect(coverage.reason).toContain('внутри контура')
  })

  it('точка вне контура — экстраполяция, даже если скважина рядом', () => {
    const coverage = geologyCoverageAt(square, 130, 50, 100)
    expect(coverage.confidence).toBe('extrapolated')
    expect(coverage.reason).toContain('за пределы изысканий')
  })

  it('ближайшая скважина дальше допуска — значение не характеризует трассу', () => {
    const coverage = geologyCoverageAt(square, 50, 50, 40)
    expect(coverage.confidence).toBe('out_of_range')
    expect(coverage.boreholesInRange).toBe(0)
    expect(coverage.reason).toContain('не характеризует трассу')
  })

  it('скважины без координат не притягиваются к трассе', () => {
    const nowhere: Borehole = { label: 'Скв. без координат', layers: [], water: {} }
    const coverage = geologyCoverageAt([nowhere], 10, 10, 50)
    expect(coverage.confidence).toBe('none')
    expect(coverage.nearestDistanceM).toBeNull()
  })

  it('двух скважин мало для контура: точка между ними — экстраполяция', () => {
    // Контур вырожден в отрезок, «внутри» не определено — модель это признаёт.
    const line = [hole('1', 0, 0), hole('2', 100, 0)]
    expect(geologyCoverageAt(line, 50, 0, 100).confidence).toBe('extrapolated')
  })
})

describe('покрытие трассы', () => {
  it('считает станции по видам достоверности и даёт долю описанных', () => {
    const path = [{ x: 50, y: 50 }, { x: 60, y: 60 }, { x: 400, y: 400 }]
    const summary = summarizeRouteCoverage(square, path, 100)
    expect(summary.stations).toBe(3)
    expect(summary.interpolated).toBe(2)
    expect(summary.outOfRange).toBe(1)
    expect(summary.covered).toBeCloseTo(2 / 3, 3)
  })

  it('станции вне допуска и за контуром становятся блокерами', () => {
    const summary = summarizeRouteCoverage(square, [{ x: 50, y: 50 }, { x: 900, y: 900 }], 100)
    expect(summary.blockers.join(' ')).toContain('вне допуска')
    const outside = summarizeRouteCoverage(square, [{ x: 130, y: 50 }], 200)
    expect(outside.blockers.join(' ')).toContain('за контуром')
  })

  it('полностью описанная трасса не даёт блокеров', () => {
    const summary = summarizeRouteCoverage(square, [{ x: 50, y: 50 }, { x: 40, y: 60 }], 100)
    expect(summary.blockers).toEqual([])
    expect(summary.covered).toBe(1)
  })

  it('сообщает наибольший разрыв до скважины по трассе', () => {
    const summary = summarizeRouteCoverage(square, [{ x: 50, y: 50 }, { x: 0, y: 0 }], 100)
    expect(summary.worstGapM).toBeCloseTo(70.71, 1)
  })
})

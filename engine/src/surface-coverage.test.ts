import { describe, expect, it } from 'vitest'
import { elevationWithinSurvey, interpolateElevation, surveyCovers } from './trace'
import { solveGravityNetwork } from './norms/gravity'
import type { SurveyPoint, TracedNetwork } from './index'

/**
 * Ноль вместо отметки поверхности — тихая подстановка, из-за которой профиль по
 * ул. Станкевича рисовал «Земля 0.00» у всех колодцев при четырнадцати точках
 * съёмки с отметками 685…688 м в том же проекте. От этого нуля дальше считались
 * уклон местности, нехватка падения и глубина заложения: три числа, каждое из
 * которых ложь, неотличимая от расчёта.
 */

const square: SurveyPoint[] = [
  { x: 0, y: 0, z: 685.1 },
  { x: 100, y: 0, z: 686.4 },
  { x: 100, y: 100, z: 688.2 },
  { x: 0, y: 100, z: 686.9 },
]

describe('отметка поверхности не подменяется нулём', () => {
  it('пустая съёмка даёт null, а не 0', () => {
    expect(interpolateElevation([], 10, 10)).toBeNull()
  })

  it('внутри контура съёмки отметка считается', () => {
    const value = elevationWithinSurvey(square, 50, 50)
    expect(value).not.toBeNull()
    expect(value!).toBeGreaterThan(685)
    expect(value!).toBeLessThan(689)
  })

  it('за контуром съёмки — отказ, а не экстраполяция', () => {
    // Обратно-взвешенное расстояние даёт правдоподобное число и в километре
    // от крайней точки. Правдоподобное — не значит известное.
    expect(surveyCovers(square, 5000, 5000)).toBe(false)
    expect(elevationWithinSurvey(square, 5000, 5000)).toBeNull()
  })

  it('трёх точек мало для контура — считать нечем', () => {
    expect(surveyCovers([{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 2 }], 0.5, 0.5)).toBe(false)
  })

  it('ноль остаётся законной отметкой там, где он измерен', () => {
    // Уровень моря — настоящая отметка. Отличить её от «не определено» можно
    // только типом, а не значением, и проверка это закрепляет.
    const sea: SurveyPoint[] = square.map((point) => ({ ...point, z: 0 }))
    expect(elevationWithinSurvey(sea, 50, 50)).toBe(0)
  })
})

function network(missingAt: string[]): TracedNetwork {
  const node = (id: string, x: number) => ({
    id, kind: 'junction' as const, x, y: 0,
    groundElevation: missingAt.includes(id) ? 0 : 686,
    ...(missingAt.includes(id) ? { groundElevationMissing: true } : {}),
  })
  return {
    nodes: [node('K1', 0), node('K2', 50), node('K3', 100)],
    pipes: [
      { id: 'p1', kind: 'ring', fromNode: 'K1', toNode: 'K2', lengthM: 50, diameterMm: 200 },
      { id: 'p2', kind: 'ring', fromNode: 'K2', toNode: 'K3', lengthM: 50, diameterMm: 200 },
    ],
    totalLengthM: 100,
  } as unknown as TracedNetwork
}

describe('профиль не строится от нулевой земли', () => {
  const solve = (missing: string[]) => solveGravityNetwork({
    network: network(missing),
    buildingFlowLps: new Map(),
    system: 'sewer',
    freezingDepthM: 2.53,
    outletNodeId: 'K3',
  })

  it('непокрытый узел останавливает профиль и называется поимённо', () => {
    const result = solve(['K2'])
    expect(result.surfaceGapNodeIds).toEqual(['K2'])
    expect(result.profile).toBeNull()
  })

  it('несколько непокрытых узлов перечисляются все', () => {
    expect(solve(['K1', 'K3']).surfaceGapNodeIds.sort()).toEqual(['K1', 'K3'])
  })

  it('при полном покрытии профиль строится и список пуст', () => {
    const result = solve([])
    expect(result.surfaceGapNodeIds).toEqual([])
    expect(result.profile).not.toBeNull()
  })
})

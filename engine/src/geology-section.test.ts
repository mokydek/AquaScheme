import { describe, expect, it } from 'vitest'
import { buildGeologySection, projectBoreholesOntoPath } from './geology-section'
import type { ProjectedBorehole } from './geology-section'
import type { Borehole } from './geology'

const hole = (
  label: string,
  chainageM: number,
  mouthElevationM: number,
  layers: Array<[string, number, number]>,
): ProjectedBorehole => ({
  chainageM,
  borehole: {
    label,
    mouthElevationM,
    water: {} as Borehole['water'],
    layers: layers.map(([igeCode, topDepthM, bottomDepthM]) => ({ igeCode, topDepthM, bottomDepthM })),
  },
})

const SAME = [['ИГЭ-1', 0, 2], ['ИГЭ-2', 2, 6]] as Array<[string, number, number]>

describe('геологический разрез вдоль трассы', () => {
  it('переносит кровлю и подошву линейно между скважинами', () => {
    // Устья 100 и 110 м, слои те же: на середине всё ровно посередине.
    const section = buildGeologySection(
      [hole('С-1', 0, 100, SAME), hole('С-2', 100, 110, SAME)], 100, 50)
    const middle = section.stations.find((station) => station.chainageM === 50)
    expect(middle).toBeTruthy()
    expect(middle!.surfaceElevationM).toBe(105)
    expect(middle!.layers[0]).toMatchObject({ igeCode: 'ИГЭ-1', topElevationM: 105, bottomElevationM: 103 })
    expect(middle!.layers[1]).toMatchObject({ igeCode: 'ИГЭ-2', topElevationM: 103, bottomElevationM: 99 })
  })

  it('точки скважин помечены измеренными, промежуточные — нет', () => {
    const section = buildGeologySection(
      [hole('С-1', 0, 100, SAME), hole('С-2', 100, 100, SAME)], 100, 50)
    expect(section.stations[0].measured).toBe(true)
    expect(section.stations.find((s) => s.chainageM === 50)!.measured).toBe(false)
    expect(section.stations.at(-1)!.measured).toBe(true)
  })

  it('разный состав слоёв разрез не строит, а называет промежуток', () => {
    // Выклинивание слоя — инженерное решение, а не измерение.
    const other = [['ИГЭ-1', 0, 2], ['ИГЭ-7', 2, 5]] as Array<[string, number, number]>
    const section = buildGeologySection(
      [hole('С-1', 0, 100, SAME), hole('С-2', 100, 100, other)], 100)
    expect(section.gaps).toHaveLength(1)
    expect(section.gaps[0]).toMatchObject({ fromChainageM: 0, toChainageM: 100 })
    expect(section.gaps[0].reason).toMatch(/состав слоёв различается/)
    expect(section.gaps[0].reason).toMatch(/решение инженера/)
    expect(section.coveragePercent).toBe(0)
    // Обе скважины при этом остаются на разрезе как измеренные точки.
    expect(section.stations.filter((s) => s.measured)).toHaveLength(2)
  })

  it('разное число слоёв тоже считается несовпадением', () => {
    const shorter = [['ИГЭ-1', 0, 2]] as Array<[string, number, number]>
    const section = buildGeologySection(
      [hole('С-1', 0, 100, SAME), hole('С-2', 100, 100, shorter)], 100)
    expect(section.gaps).toHaveLength(1)
  })

  it('за пределы крайних скважин не продолжается', () => {
    // Трасса 500 м, скважины на 100 и 300: разрез только между ними.
    const section = buildGeologySection(
      [hole('С-1', 100, 100, SAME), hole('С-2', 300, 100, SAME)], 500, 100)
    expect(Math.min(...section.stations.map((s) => s.chainageM))).toBe(100)
    expect(Math.max(...section.stations.map((s) => s.chainageM))).toBe(300)
    expect(section.coveragePercent).toBe(40)
    expect(section.reason).toMatch(/За пределы крайних скважин разрез не продолжается/)
  })

  it('одна скважина разрезом не считается', () => {
    const section = buildGeologySection([hole('С-1', 0, 100, SAME)], 100)
    expect(section.coveragePercent).toBe(0)
    expect(section.reason).toMatch(/скважина одна/)
    expect(section.stations).toHaveLength(1)
  })

  it('скважина без отметки устья или без кодов ИГЭ в разрез не идёт', () => {
    const noMouth: ProjectedBorehole = {
      chainageM: 0,
      borehole: { label: 'X', water: {} as Borehole['water'], layers: [{ igeCode: 'ИГЭ-1', topDepthM: 0, bottomDepthM: 2 }] },
    }
    const noCode = hole('Y', 100, 100, [['', 0, 2]])
    expect(buildGeologySection([noMouth, noCode], 100).stations).toEqual([])
    expect(buildGeologySection([noMouth, noCode], 100).reason).toMatch(/нет ни одной скважины/)
  })

  it('скважины упорядочиваются по пикетажу независимо от порядка на входе', () => {
    const section = buildGeologySection(
      [hole('С-2', 100, 110, SAME), hole('С-1', 0, 100, SAME)], 100, 50)
    expect(section.stations[0].chainageM).toBe(0)
    expect(section.stations[0].surfaceElevationM).toBe(100)
    expect(section.stations.at(-1)!.chainageM).toBe(100)
  })

  it('шаг промежуточных точек соблюдается', () => {
    const section = buildGeologySection(
      [hole('С-1', 0, 100, SAME), hole('С-2', 200, 100, SAME)], 200, 25)
    // 200 м при шаге 25 → 8 промежуточных точек плюс начальная.
    expect(section.stations).toHaveLength(9)
    expect(section.stations[1].chainageM).toBe(25)
  })

  it('три скважины: один промежуток может строиться, другой нет', () => {
    const other = [['ИГЭ-1', 0, 3]] as Array<[string, number, number]>
    const section = buildGeologySection([
      hole('С-1', 0, 100, SAME), hole('С-2', 100, 100, SAME), hole('С-3', 200, 100, other),
    ], 200, 50)
    expect(section.gaps).toHaveLength(1)
    expect(section.gaps[0]).toMatchObject({ fromChainageM: 100, toChainageM: 200 })
    expect(section.coveragePercent).toBe(50)
  })
})

describe('проекция скважин на ось', () => {
  const path = [
    { x: 0, y: 0, chainageM: 0 },
    { x: 100, y: 0, chainageM: 100 },
  ]
  const at = (label: string, x: number, y: number): Borehole =>
    ({ label, x, y, mouthElevationM: 100, water: {} as Borehole['water'], layers: [] })

  it('даёт пикетаж проекции и удаление от оси', () => {
    const result = projectBoreholesOntoPath([at('С-1', 40, 12)], path, 25)
    expect(result.projected).toHaveLength(1)
    expect(result.projected[0].chainageM).toBeCloseTo(40, 6)
  })

  it('скважина дальше предела не используется вовсе', () => {
    // Спроецировать её значило бы выдать чужую выработку за описание трассы.
    const result = projectBoreholesOntoPath([at('С-1', 40, 60)], path, 25)
    expect(result.projected).toEqual([])
    expect(result.rejected).toEqual([{ label: 'С-1', offsetM: 60 }])
    expect(result.reason).toMatch(/отброшено как удалённые более 25 м/)
  })

  it('без предела отбор не выполняется и умолчания не берёт', () => {
    for (const limit of [null, undefined, 0, -5]) {
      const result = projectBoreholesOntoPath([at('С-1', 40, 1)], path, limit)
      expect(result.projected).toEqual([])
      expect(result.reason).toMatch(/Не задано предельное удаление/)
    }
  })

  it('скважина без координат пропускается молча: её положение не измерено', () => {
    const noCoords = { label: 'X', mouthElevationM: 100, water: {} as Borehole['water'], layers: [] }
    expect(projectBoreholesOntoPath([noCoords], path, 25).projected).toEqual([])
  })

  it('ось короче двух точек проецировать не на что', () => {
    expect(projectBoreholesOntoPath([at('С-1', 0, 0)], [path[0]], 25).reason).toMatch(/короче двух точек/)
  })
})

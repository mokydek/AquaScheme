import { describe, expect, it } from 'vitest'
import {
  gridToGeologyRows,
  guessGeologyField,
  parseGeologyRows,
  summarizeGeology,
} from './geology'

const TEMPLATE_ROWS = [
  {
    'Скважина': 'С-1', 'X': 0, 'Y': 0, 'Отметка устья, м': 351.2,
    'ИГЭ': '1', 'Грунт': 'суглинок', 'Кровля слоя, м': 0, 'Подошва слоя, м': 2.5,
    'Плотность, г/см3': 1.95, 'Угол трения, град': 21, 'Сцепление, кПа': 24,
    'УГВ, м': 3.4, 'Агрессивность к стали': 'средняя',
  },
  {
    'Скважина': 'С-1', 'ИГЭ': '2', 'Грунт': 'песок', 'Кровля слоя, м': 2.5, 'Подошва слоя, м': 6,
    'Коэффициент фильтрации, м/сут': 5,
  },
  {
    'Скважина': 'С-2', 'X': 110, 'Y': 20, 'Отметка устья, м': 352.8,
    'ИГЭ': '1', 'Грунт': 'суглинок', 'Кровля слоя, м': 0, 'Подошва слоя, м': 3,
    'УГВ, м': 4.1, 'Агрессивность к стали': 'высокая',
  },
]

describe('parseGeologyRows', () => {
  it('groups layers under boreholes and reads coordinates and water', () => {
    const { boreholes, issues } = parseGeologyRows(TEMPLATE_ROWS)
    expect(issues).toHaveLength(0)
    expect(boreholes).toHaveLength(2)
    const s1 = boreholes[0]
    expect(s1.label).toBe('С-1')
    expect(s1.x).toBe(0)
    expect(s1.mouthElevationM).toBe(351.2)
    expect(s1.layers).toHaveLength(2)
    expect(s1.layers[0].igeCode).toBe('1')
    expect(s1.layers[0].frictionAngleDeg).toBe(21)
    expect(s1.layers[1].filtrationMDay).toBe(5)
    expect(s1.water.depthM).toBe(3.4)
    expect(s1.water.aggressivenessSteel).toBe('medium')
  })

  it('flags a row with data but no borehole label', () => {
    const { issues } = parseGeologyRows([{ 'Грунт': 'песок', 'Кровля слоя, м': 0 }])
    expect(issues).toEqual([{ row: 2, code: 'noBorehole' }])
  })

  it('flags non numeric values and inverted depths', () => {
    const result = parseGeologyRows([
      { 'Скважина': 'С-1', 'Кровля слоя, м': 'abc', 'Подошва слоя, м': 2 },
      { 'Скважина': 'С-1', 'Кровля слоя, м': 3, 'Подошва слоя, м': 1 },
    ])
    expect(result.issues.map((i) => i.code)).toEqual(['badNumber', 'badDepths'])
    expect(result.boreholes).toHaveLength(1)
    expect(result.boreholes[0].layers).toHaveLength(0)
  })

  it('flags an unrecognized aggressiveness value', () => {
    const { issues } = parseGeologyRows([
      { 'Скважина': 'С-1', 'Кровля слоя, м': 0, 'Подошва слоя, м': 2, 'Агрессивность к бетону': 'жуть' },
    ])
    expect(issues).toEqual([{ row: 2, code: 'badAggressiveness' }])
  })

  it('skips fully empty rows silently', () => {
    const { boreholes, issues } = parseGeologyRows([{ 'Скважина': '', 'Грунт': '' }])
    expect(boreholes).toHaveLength(0)
    expect(issues).toHaveLength(0)
  })
})

describe('guessGeologyField', () => {
  it('matches canonical headers and loose variants', () => {
    expect(guessGeologyField('Скважина')).toBe('label')
    expect(guessGeologyField('ИГЭ')).toBe('igeCode')
    expect(guessGeologyField('Угол внутреннего трения, град')).toBe('frictionAngleDeg')
    expect(guessGeologyField('УГВ, м')).toBe('depthM')
  })
  it('returns null for unclear headers', () => {
    expect(guessGeologyField('примечание')).toBeNull()
    expect(guessGeologyField('')).toBeNull()
  })
})

describe('gridToGeologyRows', () => {
  it('maps columns to fields, skips the header row and unmapped columns', () => {
    const grid = [
      ['Скв', 'ИГЭ', 'от', 'до', 'прим'],
      ['С-1', '1', '0', '2.5', 'x'],
      ['С-1', '2', '2.5', '6', 'y'],
    ]
    const mapping = ['label', 'igeCode', 'topDepthM', 'bottomDepthM', null] as const
    const rows = gridToGeologyRows(grid, [...mapping], true)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ 'Скважина': 'С-1', 'ИГЭ': '1', 'Кровля слоя, м': '0', 'Подошва слоя, м': '2.5' })
    // The mapped rows feed straight back into the parser.
    const parsed = parseGeologyRows(rows)
    expect(parsed.boreholes).toHaveLength(1)
    expect(parsed.boreholes[0].layers).toHaveLength(2)
  })
})

describe('summarizeGeology', () => {
  it('reports counts, IGE codes, shallowest water and worst aggressiveness', () => {
    const { boreholes } = parseGeologyRows(TEMPLATE_ROWS)
    const summary = summarizeGeology({ boreholes })
    expect(summary.boreholes).toBe(2)
    expect(summary.layers).toBe(3)
    expect(summary.igeCodes).toEqual(['1', '2'])
    expect(summary.minWaterDepthM).toBe(3.4)
    expect(summary.maxAggressiveness).toBe('high')
  })

  it('returns nulls when nothing is reported', () => {
    const summary = summarizeGeology({ boreholes: [] })
    expect(summary.minWaterDepthM).toBeNull()
    expect(summary.maxAggressiveness).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  gridToGeologyRows,
  guessGeologyField,
  parseGeologyRows,
  parseGeologyReportSummary,
  parseGroundwaterRange,
  parseIgeDescriptions,
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

describe('parseIgeDescriptions / parseGroundwaterRange (prose reports)', () => {
  const PROSE = `
  ИГЭ 0 – растительный слой почвы. Мощность слоя 0,4м.
  ИГЭ 2 – суглинок коричневого цвета, от твердой до мягкопластичной консистенции с прослоями песка. Вскрыт с глубины 0,0-3,0м. Мощность слоя 3,0-5,6м.
  ИГЭ 2-1 – суглинок заиленный, серого цвета. Вскрыт с глубины 3,5-5,7м. Мощность слоя 1,1-7,8м.
  Подземные воды на участке проектирования вскрыты на глубине 0,5-5,6м (абсолютные отметки).
  `
  it('reads ИГЭ codes, names, opening depth and thickness from prose', () => {
    const ige = parseIgeDescriptions(PROSE)
    expect(ige.map((i) => i.code)).toEqual(['0', '2', '2-1'])
    expect(ige[0].thicknessM).toBe(0.4)
    expect(ige[1].name).toContain('суглинок коричневого цвета')
    expect(ige[1].openedFromM).toBe(0)
    expect(ige[1].thicknessM).toBe(5.6)
    expect(ige[2].code).toBe('2-1')
    expect(ige[2].openedFromM).toBe(3.5)
  })

  it('reads the groundwater depth range from prose', () => {
    expect(parseGroundwaterRange(PROSE)).toEqual({ minDepthM: 0.5, maxDepthM: 5.6 })
    expect(parseGroundwaterRange('текст без воды')).toBeNull()
  })

  it('extracts a conservative, reviewable project summary', () => {
    const summary = parseGeologyReportSummary(`${PROSE}
      Нормативная глубина сезонного промерзания грунтов, см:
      - суглинки и глины - 171; пески мелкие - 208; пески крупные - 222; крупнообломочные грунты - 253.
      Коррозионная активность грунтов по отношению к углеродистой стали - высокая.
      Район не сейсмоактивен.`)
    expect(summary.ige.map((item) => item.code)).toEqual(['0', '2', '2-1'])
    expect(summary.groundwater).toEqual({ minDepthM: 0.5, maxDepthM: 5.6 })
    // В отчёте коллектора промерзание дано ЧЕТЫРЬМЯ величинами по грунтам.
    // Прежде извлечение возвращало 2,53 — наибольшую «в запас»; это был
    // молчаливый выбор за инженера, и его больше нет: величина не определена,
    // пока инженер не выберет грунт на отметке трубы.
    expect(summary.freezingDepthM).toBeNull()
    expect(summary.freezingDepthCandidates.map((item) => [item.soil, item.valueM])).toEqual([
      ['суглинки и глины', 1.71],
      ['пески мелкие', 2.08],
      ['пески крупные', 2.22],
      ['крупнообломочные грунты', 2.53],
    ])
    expect(summary.freezingDepthCandidates.every((item) => item.readAs === 'cm')).toBe(true)
    expect(summary.maxAggressiveness).toBe('high')
    expect(summary.seismicInactive).toBe(true)
  })

  it('deduplicates IGE descriptions repeated later in legends', () => {
    expect(parseIgeDescriptions(`${PROSE}\n${PROSE}`).map((item) => item.code)).toEqual(['0', '2', '2-1'])
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

describe('глубины по скважине обязаны расти', () => {
  const row = (label: string, top: string, bottom: string) => ({
    'Скважина': label, 'Кровля, м': top, 'Подошва, м': bottom,
  })

  it('нормальная скважина сомнительной не считается', () => {
    const parsed = parseGeologyRows([row('С-1', '0.0', '1.2'), row('С-1', '1.2', '3.4')])
    expect(parsed.doubtful).toEqual([])
    expect(parsed.boreholes[0].layers).toHaveLength(2)
  })

  it('перекрытие пластов помечает скважину, а не чинится сортировкой', () => {
    const parsed = parseGeologyRows([row('С-1', '0.0', '2.0'), row('С-1', '1.0', '3.0')])
    expect(parsed.doubtful).toEqual([{ label: 'С-1', code: 'depthsNotMonotonic', atDepthM: 2 }])
    // Слои остались в том порядке, в каком пришли: улика не стёрта.
    expect(parsed.boreholes[0].layers.map((layer) => layer.topDepthM)).toEqual([0, 1])
  })

  it('переставленные местами строки не пересортировываются молча', () => {
    const parsed = parseGeologyRows([row('С-1', '1.2', '3.4'), row('С-1', '0.0', '1.2')])
    expect(parsed.doubtful[0].label).toBe('С-1')
    expect(parsed.boreholes[0].layers.map((layer) => layer.topDepthM)).toEqual([1.2, 0])
  })

  it('сомнительной становится вся скважина, соседняя не страдает', () => {
    const parsed = parseGeologyRows([
      row('С-1', '0.0', '2.0'), row('С-1', '1.0', '3.0'),
      row('С-2', '0.0', '1.0'), row('С-2', '1.0', '2.0'),
    ])
    expect(parsed.doubtful.map((item) => item.label)).toEqual(['С-1'])
  })
})


describe('глубина промерзания читается во всех записях и не выбирается молча', () => {
  it('метры с запятой и точкой приводятся к метрам с указанием прочтения', () => {
    const summary = parseGeologyReportSummary(`Нормативная глубина промерзания по г. Алматы
      Нормативная глубина сезонного промерзания для суглинков – 0,79м, для песка пылеватого – 0,96м,
      для песка средней крупности – 1.03 м.`)
    expect(summary.freezingDepthCandidates.map((item) => [item.soil, item.valueM, item.readAs])).toEqual([
      ['суглинков', 0.79, 'm'],
      ['песка пылеватого', 0.96, 'm'],
      ['песка средней крупности', 1.03, 'm'],
    ])
    // Три величины — значит, не определено: выбирает инженер по грунту на
    // отметке трубы.
    expect(summary.freezingDepthM).toBeNull()
  })

  it('одна величина остаётся значением, как и было', () => {
    const summary = parseGeologyReportSummary(
      'Нормативная глубина сезонного промерзания грунтов, см: - суглинки - 171.',
    )
    expect(summary.freezingDepthM).toBe(1.71)
    expect(summary.freezingDepthCandidates).toHaveLength(1)
    expect(summary.freezingDepthCandidates[0].readAs).toBe('cm')
  })

  it('без раздела промерзания кандидатов нет', () => {
    const summary = parseGeologyReportSummary('Грунтовые воды не вскрыты. Район не сейсмоактивен.')
    expect(summary.freezingDepthM).toBeNull()
    expect(summary.freezingDepthCandidates).toHaveLength(0)
  })
})

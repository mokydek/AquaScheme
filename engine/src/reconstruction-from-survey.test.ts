import { describe, expect, it } from 'vitest'
import type { DxfNetworkData } from './dxfread'
import { buildReconstructionFromSurvey } from './reconstruction-from-survey'

/**
 * A short street run: four chambers 60 m apart with a falling invert, a survey
 * grid whose lines are labelled, spot heights, and one water main crossing.
 */
function streetSurvey(): DxfNetworkData {
  const segments: DxfNetworkData['segments'] = []
  const textEntities: NonNullable<DxfNetworkData['textEntities']> = []

  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const cx = i * 50
      const cy = j * 50
      segments.push({ layer: 'd-Grid', points: [{ x: cx - 2, y: cy }, { x: cx + 2, y: cy }] })
      segments.push({ layer: 'd-Grid', points: [{ x: cx, y: cy - 2 }, { x: cx, y: cy + 2 }] })
      if (i === 0) textEntities.push({ x: -1, y: cy + 1, layer: 'РЕЛЬЕФ', text: String(cy) })
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = i * 60
    textEntities.push({ x, y: 0.5, layer: 'NAD_MКАНАЛИЗ', text: (688 - i * 0.2).toFixed(2) })
    textEntities.push({ x, y: -0.5, layer: 'NAD_MКАНАЛИЗ', text: (685 - i * 0.3).toFixed(2) })
    textEntities.push({ x: x + 10, y: 3, layer: 'NAD_MКАНАЛИЗ', text: 'кер.300' })
  }
  for (let i = 0; i < 12; i++) {
    textEntities.push({ x: i * 15, y: 12, layer: 'PI_OTРЕЛЬЕФ', text: (688.4 - i * 0.05).toFixed(2) })
  }
  segments.push({ layer: 'SIT_LВОДОПРО', points: [{ x: 95, y: -20 }, { x: 95, y: 20 }] })
  textEntities.push({ x: 95, y: 2, layer: 'NAD_MВОДОПРО', text: '686.10' })

  return {
    ok: true,
    points: [],
    layers: ['d-Grid', 'NAD_MКАНАЛИЗ', 'PI_OTРЕЛЬЕФ', 'SIT_LВОДОПРО', 'РЕЛЬЕФ']
      .map((name) => ({ name, segments: 1, points: 0 })),
    segments,
    textEntities,
  }
}

describe('reconstruction assembled from a survey', () => {
  it('produces network, profile, schedule and crossings in one pass', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })

    expect(result.network.nodes).toHaveLength(4)
    expect(result.network.pipes).toHaveLength(3)
    // Gravity terms: chambers ending at an outlet, not a supply ring.
    expect(result.network.nodes.map((n) => n.kind)).toEqual(['manhole', 'manhole', 'manhole', 'outlet'])
    expect(result.totalLengthM).toBeCloseTo(180, 0)

    // The profile follows the existing inverts, not a recomputed slope.
    expect(result.profile.stations.map((s) => s.invertElevationM)).toEqual([685, 684.7, 684.4, 684.1])
    expect(result.profile.stations.every((s) => s.diameterMm === 450)).toBe(true)

    expect(result.schedule.manholes.map((m) => m.label)).toEqual(['КК-1', 'КК-2', 'КК-3', 'КК-4'])
    expect(result.schedule.manholes[0].picket).toBe('ПК0')
    // Спецификация заказывает трубу, а труба лежит между стенками камер: из
    // 180 м оси вычитаются три участка по 1,5 м (п. 7.4.2 при глубине > 1,8 м).
    expect(result.schedule.totalPipeLengthM).toBeCloseTo(175.5, 2)
    expect(result.pipeLength.axisLengthM).toBeCloseTo(180, 0)
    expect(result.pipeLength.deductionM).toBeCloseTo(4.5, 2)
    // DN450 is a transcribed catalogue position, so the exact code is carried.
    expect(result.schedule.pipes[0].agskCode).toBe('241-702-0903')

    expect(result.crossings.map((c) => c.kind)).toEqual(['водопровод'])
    expect(result.crossings[0].existingElevationM).toBe(686.1)
    expect(result.crossings[0].clearanceM).toBeGreaterThan(0)
  })

  it('carries the georeference through when the grid lines are labelled', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    expect(result.grid.detected).toBe(true)
    expect(result.grid.pitchX).toBe(50)
    expect(result.georeference.kind).toBe('survey_grid')
    expect(result.blockers.join(' ')).not.toContain('Начало координат')
  })

  it('привязка отдаётся в том виде, какой принимает набор чертежей', () => {
    // Не `local_anchor`: у него без якоря перевод в градусы берёт запасной
    // (Астана), и объект из другого города встал бы на карту не на своё место.
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    expect(result.georeference).toEqual({
      kind: 'survey_grid',
      pitchM: 50,
      source: expect.any(String),
    })
  })

  it('неподписанная сетка привязкой не считается', () => {
    const data = streetSurvey()
    // Те же штрихи сетки, но без подписей координат.
    data.textEntities = (data.textEntities ?? []).filter((e) => e.layer !== 'РЕЛЬЕФ')
    const result = buildReconstructionFromSurvey(data, { designDiameterMm: 450 })
    expect(result.georeference.kind).toBe('unreferenced')
    expect(result.blockers.some((b) => b.includes('начало координат'))).toBe(true)
  })

  it('falls back to the подраздел when the bore is not a transcribed position', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 1200 })
    expect(result.schedule.pipes[0].agskCode).toBe('241-7')
  })

  it('refuses to guess the design bore', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 0 })
    expect(result.blockers.some((b) => b.includes('проектный диаметр'))).toBe(true)
  })

  it('blocks when the survey has no chamber chain', () => {
    const bare: DxfNetworkData = { ok: true, points: [], layers: [], segments: [], textEntities: [] }
    const result = buildReconstructionFromSurvey(bare, { designDiameterMm: 450 })
    expect(result.network.nodes).toEqual([])
    expect(result.crossings).toEqual([])
    expect(result.reason).toContain('нет цепочки колодцев')
    expect(result.blockers.some((b) => b.includes('цепочка существующих колодцев'))).toBe(true)
  })

  it('counts crossings whose elevation was never levelled', () => {
    const data = streetSurvey()
    // A gas main nobody levelled.
    data.segments.push({ layer: 'SIT_LГАЗОПРО', points: [{ x: 140, y: -20 }, { x: 140, y: 20 }] })
    data.layers.push({ name: 'SIT_LГАЗОПРО', segments: 1, points: 0 })
    const result = buildReconstructionFromSurvey(data, { designDiameterMm: 450 })
    expect(result.crossings).toHaveLength(2)
    expect(result.blockers.some((b) => b.includes('без снятой отметки'))).toBe(true)
  })

  it('принимает роли слоёв, назначенные инженером', () => {
    const data = streetSurvey()
    data.segments.push({ layer: 'ЗАБОРЫ', points: [{ x: 0, y: 30 }, { x: 200, y: 30 }] })
    data.layers.push({ name: 'ЗАБОРЫ', segments: 1, points: 0 })

    // По имени слой не опознаётся и блокирует выпуск.
    const auto = buildReconstructionFromSurvey(data, { designDiameterMm: 450 })
    expect(auto.constraints.roles['ЗАБОРЫ']).toBe('unknown')

    // Инженер отмечает его как не инженерный — слой перестаёт быть нерешённым.
    const reviewed = buildReconstructionFromSurvey(data, {
      designDiameterMm: 450,
      roleOverrides: { 'ЗАБОРЫ': 'ignore' },
    })
    expect(reviewed.constraints.roles['ЗАБОРЫ']).toBe('ignore')
    const unknownCount = (result: typeof auto) =>
      Object.values(result.constraints.roles).filter((r) => r === 'unknown').length
    expect(unknownCount(reviewed)).toBe(unknownCount(auto) - 1)

    // Роль меняет и сам разбор, а не только счётчик нерешённых.
    const asUtility = buildReconstructionFromSurvey(data, {
      designDiameterMm: 450,
      roleOverrides: { 'ЗАБОРЫ': 'utility' },
    })
    expect(asUtility.constraints.utilityLines.length).toBe(auto.constraints.utilityLines.length + 1)
  })

  it('выводит диапазоны глубин из съёмки без участия инженера', () => {
    // Съёмка подписывает канализацию парой отметок в каждом колодце: 688/685,
    // 687.8/684.7, … — разность и есть глубина заложения.
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    expect(result.depthBands.samples['канализация']).toBe(4)
    expect(result.depthBands.bands['канализация'].minM).toBeCloseTo(3, 2)
    expect(result.depthBands.bands['канализация'].maxM).toBeCloseTo(3.3, 2)
    expect(result.depthBands.bands['канализация'].source).toContain('измерено на площадке')
  })

  it('без требуемого просвета отбор не выполняется и это сказано прямо', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    expect(result.crossingTriage).toBeNull()
    // Диапазоны при этом всё равно выведены — не хватает только величины из ТУ.
    expect(Object.keys(result.depthBands.bands).length).toBeGreaterThan(0)
  })

  it('с требуемым просветом отбирает на вскрытие только спорные пересечения', () => {
    const data = streetSurvey()
    // Кабель связи на мелком залегании и газопровод — оба не отнивелированы.
    data.segments.push({ layer: 'SIT_LЛИН_СВЯ', points: [{ x: 140, y: -20 }, { x: 140, y: 20 }] })
    data.layers.push({ name: 'SIT_LЛИН_СВЯ', segments: 1, points: 0 })
    // Пара отметок даёт диапазон 0,6…0,9 м: кабель лежит заведомо выше трубы.
    data.textEntities?.push(
      { x: 200, y: 30, layer: 'NAD_MЛИН_СВЯ', text: '688.00' },
      { x: 200, y: 30.4, layer: 'NAD_MЛИН_СВЯ', text: '687.40' },
      { x: 260, y: 30, layer: 'NAD_MЛИН_СВЯ', text: '687.90' },
      { x: 260, y: 30.4, layer: 'NAD_MЛИН_СВЯ', text: '687.00' },
    )
    const result = buildReconstructionFromSurvey(data, {
      designDiameterMm: 450,
      requiredClearanceM: 0.2,
    })
    expect(result.crossingTriage).not.toBeNull()
    const triage = result.crossingTriage!
    // Водопровод отнивелирован съёмкой, кабель проходит с запасом по расчёту.
    expect(triage.items.map((item) => item.verdict).sort())
      .toEqual(['clears_by_margin', 'levelled'])
    expect(triage.needLevelling).toHaveLength(0)
    expect(result.blockers.some((b) => b.includes('Контрольное вскрытие'))).toBe(false)
    expect(result.blockers.some((b) => b.includes('без снятой отметки'))).toBe(false)
  })

  it('оставляет на вскрытие сеть, для которой съёмка диапазона не дала', () => {
    const data = streetSurvey()
    // Газопровод без единой подписи: диапазон вывести не из чего.
    data.segments.push({ layer: 'SIT_LГАЗОПРО', points: [{ x: 140, y: -20 }, { x: 140, y: 20 }] })
    data.layers.push({ name: 'SIT_LГАЗОПРО', segments: 1, points: 0 })
    const result = buildReconstructionFromSurvey(data, {
      designDiameterMm: 450,
      requiredClearanceM: 0.2,
    })
    const triage = result.crossingTriage!
    expect(triage.needLevelling).toHaveLength(1)
    expect(triage.needLevelling[0].crossing.kind).toBe('газопровод')
    expect(triage.needLevelling[0].verdict).toBe('unknown_band')
    expect(result.blockers.some((b) => b.includes('Контрольное вскрытие: 1 пересечений из 2'))).toBe(true)
  })

  it('выявляет переходы под автомобильными дорогами', () => {
    const data = streetSurvey()
    // Дорога поперёк трассы примерно на ПК1.
    data.segments.push({ layer: 'SIT_LДОРОГИ', points: [{ x: 100, y: -30 }, { x: 100, y: 30 }] })
    data.layers.push({ name: 'SIT_LДОРОГИ', segments: 1, points: 0 })
    const result = buildReconstructionFromSurvey(data, { designDiameterMm: 450 })

    expect(result.roadCrossings).toHaveLength(1)
    expect(result.roadCrossings[0].kind).toBe('автомобильная дорога')
    expect(result.roadCrossings[0].stationM).toBeCloseTo(100, 0)
    expect(result.roadCrossings[0].source).toContain('SIT_LДОРОГИ')
    // Длина футляра не подставляется: она считается по ширине дороги, а её в
    // чертеже нет, и принятое по умолчанию значение стало бы догадкой в проекте.
    expect(result.roadCrossings[0].casingLengthM).toBeUndefined()
    expect(result.blockers.some((message) => message.includes('футляра'))).toBe(true)
  })

  it('без дорог в чертеже переходов не выдумывается', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    expect(result.roadCrossings).toEqual([])
    expect(result.blockers.some((message) => message.includes('футляра'))).toBe(false)
  })
})

describe('расход, которого из съёмки не выводится', () => {
  it('назван стоп-фактором самим модулем, а не только гидравликой', () => {
    const result = buildReconstructionFromSurvey(streetSurvey(), { designDiameterMm: 450 })
    const flow = result.blockers.find((blocker) => blocker.includes('Расчётный расход'))
    expect(flow).toBeDefined()
    // Названа и причина невыводимости, и источник величины.
    expect(flow).toContain('за границами чертежа')
    expect(flow).toContain('технических условий')
  })
})

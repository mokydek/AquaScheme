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
    expect(result.totalLengthM).toBeCloseTo(180, 0)

    // The profile follows the existing inverts, not a recomputed slope.
    expect(result.profile.stations.map((s) => s.invertElevationM)).toEqual([685, 684.7, 684.4, 684.1])
    expect(result.profile.stations.every((s) => s.diameterMm === 450)).toBe(true)

    expect(result.schedule.manholes.map((m) => m.label)).toEqual(['КК-1', 'КК-2', 'КК-3', 'КК-4'])
    expect(result.schedule.manholes[0].picket).toBe('ПК0')
    expect(result.schedule.totalPipeLengthM).toBeCloseTo(180, 0)
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
    expect(result.georeference?.kind).toBe('survey_grid')
    expect(result.blockers.join(' ')).not.toContain('Начало координат')
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
})

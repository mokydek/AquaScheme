import { describe, expect, it } from 'vitest'
import type { DxfNetworkData } from './dxfread'
import { detectSurveyGrid } from './surveygrid'

/** A survey grid drawn as crossing ticks at `pitch`, optionally rotated. */
function gridFixture(options: {
  pitch?: number
  layer?: string
  nx?: number
  ny?: number
  originX?: number
  originY?: number
  labelValue?: (coordinate: number) => number
  rotationDeg?: number
} = {}): DxfNetworkData {
  const pitch = options.pitch ?? 50
  const layer = options.layer ?? 'd-Grid'
  const nx = options.nx ?? 8
  const ny = options.ny ?? 10
  const originX = options.originX ?? 0
  const originY = options.originY ?? 0
  const theta = ((options.rotationDeg ?? 0) * Math.PI) / 180
  const segments: DxfNetworkData['segments'] = []
  const textEntities: NonNullable<DxfNetworkData['textEntities']> = []

  const rotate = (x: number, y: number) => ({
    x: x * Math.cos(theta) - y * Math.sin(theta),
    y: x * Math.sin(theta) + y * Math.cos(theta),
  })

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const cx = originX + i * pitch
      const cy = originY + j * pitch
      for (const [dx, dy] of [[2, 0], [0, 2]] as const) {
        const a = rotate(cx - dx, cy - dy)
        const b = rotate(cx + dx, cy + dy)
        segments.push({ layer, points: [a, b] })
      }
      if (options.labelValue && i === 0) {
        textEntities.push({
          x: originX - 1, y: cy + 1, layer: 'РЕЛЬЕФ',
          text: String(options.labelValue(cy)),
        })
      }
    }
  }
  return {
    ok: true,
    points: [],
    layers: [{ name: layer, segments: segments.length, points: 0 }],
    segments,
    textEntities,
  }
}

describe('survey coordinate grid', () => {
  it('measures pitch and confirms metric, unrotated drawing units', () => {
    const finding = detectSurveyGrid(gridFixture({ pitch: 50, originX: -7300, originY: -9850 }))
    expect(finding.detected).toBe(true)
    expect(finding.layer).toBe('d-Grid')
    expect(finding.pitchX).toBe(50)
    expect(finding.pitchY).toBe(50)
    expect(finding.rotationDeg).toBeLessThan(0.5)
    expect(finding.metricConfirmed).toBe(true)
    // Nothing labels the lines, so the origin stays an open question.
    expect(finding.offset).toBeNull()
    expect(finding.offsetSource).toBe('none')
    expect(finding.reason).toContain('Начало координат не подписано')
  })

  it('derives the drawing-to-survey shift when the lines are labelled', () => {
    // Labels carry the survey coordinate of their own line: no shift.
    const finding = detectSurveyGrid(gridFixture({
      pitch: 50, originY: 7850, labelValue: (coordinate) => coordinate,
    }))
    expect(finding.detected).toBe(true)
    expect(finding.offsetSource).toBe('grid_labels')
    expect(finding.offset).toEqual({ dx: 0, dy: 0 })
  })

  it('reports the coarsest interval, not a finer one the nodes also satisfy', () => {
    // Every node of a 50 m grid also sits on a 10 m grid, so a detector that
    // simply maximises matches would report 10 m and understate the interval.
    const finding = detectSurveyGrid(gridFixture({ pitch: 50 }))
    expect(finding.pitchX).toBe(50)
    expect(finding.pitchY).toBe(50)
  })

  it('finds the grid even when the layer also carries unrelated short marks', () => {
    const data = gridFixture({ pitch: 50, layer: '0' })
    for (let i = 0; i < 60; i++) {
      const x = 17.3 + i * 6.1
      const y = 23.7 + i * 4.3
      data.segments.push({ layer: '0', points: [{ x, y }, { x: x + 1.5, y: y + 0.4 }] })
    }
    const finding = detectSurveyGrid(data)
    expect(finding.detected).toBe(true)
    expect(finding.pitchX).toBe(50)
    // The strays must not be counted as grid nodes.
    expect(finding.nodeCount).toBeLessThan(data.segments.length)
  })

  it('reports a rotated grid instead of silently treating it as aligned', () => {
    const finding = detectSurveyGrid(gridFixture({ pitch: 50, rotationDeg: 12 }))
    expect(finding.detected).toBe(true)
    expect(finding.metricConfirmed).toBe(false)
    expect(finding.rotationDeg).toBeGreaterThan(1)
  })

  it('ignores long linework so contours and roads are not read as a grid', () => {
    const data = gridFixture()
    data.segments = data.segments.map((segment) => ({
      ...segment,
      points: [segment.points[0], { x: segment.points[0].x + 400, y: segment.points[0].y + 130 }],
    }))
    const finding = detectSurveyGrid(data)
    expect(finding.detected).toBe(false)
    expect(finding.reason).toContain('координатная сетка')
  })

  it('rejects an irregular scatter of short marks', () => {
    const data = gridFixture()
    data.segments = data.segments.map((segment, index) => ({
      ...segment,
      points: [
        { x: segment.points[0].x + index * 7.3, y: segment.points[0].y - index * 3.1 },
        { x: segment.points[1].x + index * 7.3, y: segment.points[1].y - index * 3.1 },
      ],
    }))
    expect(detectSurveyGrid(data).detected).toBe(false)
  })
})

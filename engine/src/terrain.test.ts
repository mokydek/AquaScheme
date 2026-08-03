import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { buildTerrain, contourStepFor } from './terrain'

describe('contourStepFor', () => {
  it('matches survey plan intervals', () => {
    expect(contourStepFor(5)).toBe(0.5)
    expect(contourStepFor(12)).toBe(1)
    expect(contourStepFor(30)).toBe(2)
  })
})

describe('buildTerrain', () => {
  const demo = createDemoDataset()
  const terrain = buildTerrain(demo.surveyPoints)

  it('builds a TIN over the demo survey', () => {
    expect(terrain.tin.features.length).toBeGreaterThan(300)
  })

  it('produces contour lines within the elevation range', () => {
    expect(terrain.contours.features.length).toBeGreaterThan(3)
    for (const feature of terrain.contours.features) {
      const z = (feature.properties as { z: number }).z
      expect(z).toBeGreaterThanOrEqual(terrain.zMin)
      expect(z).toBeLessThanOrEqual(terrain.zMax)
    }
  })

  it('reports a geographic bbox near the anchor', () => {
    const [lonMin, latMin, lonMax, latMax] = terrain.bbox
    expect(lonMin).toBeGreaterThan(71.3)
    expect(lonMax).toBeLessThan(71.5)
    expect(latMin).toBeGreaterThan(51.0)
    expect(latMax).toBeLessThan(51.2)
  })

  it('keeps contours inside the surveyed area', () => {
    // Сетчатая интерполяция рисовала рельеф по всему габаритному прямоугольнику,
    // включая неснятые места. Горизонталь по треугольникам съёмки за её пределы
    // выйти не может — это и проверяем.
    const [lonMin, latMin, lonMax, latMax] = terrain.bbox
    for (const feature of terrain.contours.features) {
      for (const [lon, lat] of (feature.geometry as { coordinates: number[][] }).coordinates) {
        expect(lon).toBeGreaterThanOrEqual(lonMin)
        expect(lon).toBeLessThanOrEqual(lonMax)
        expect(lat).toBeGreaterThanOrEqual(latMin)
        expect(lat).toBeLessThanOrEqual(latMax)
      }
    }
  })

  it('marks every fifth contour as an index line', () => {
    const indexed = terrain.contours.features.filter(
      (f) => (f.properties as { index: boolean }).index)
    expect(indexed.length).toBeGreaterThan(0)
    for (const feature of indexed) {
      const z = (feature.properties as { z: number }).z
      expect(Math.round(z / terrain.contourStep) % 5).toBe(0)
    }
  })

  it('an empty survey yields nothing rather than throwing', () => {
    const blank = buildTerrain([])
    expect(blank.tin.features).toHaveLength(0)
    expect(blank.contours.features).toHaveLength(0)
    expect(blank.bbox).toEqual([0, 0, 0, 0])
  })
})

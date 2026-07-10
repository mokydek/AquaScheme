import type { SurveyPoint } from './types'

/**
 * Built in demo dataset: a synthetic residential district used to run the
 * whole pipeline without real survey data. Fully deterministic.
 *
 * Site: about 660 x 450 m, gentle rise to the east plus two soft hills.
 * Buildings: 40 dwellings in a street grid, 1..5 storeys.
 * Source: water treatment plant at the west edge of the site.
 */

export interface DemoBuilding {
  label: string
  x: number
  y: number
  floors: number
  residents: number
}

export interface DemoSource {
  x: number
  y: number
  groundElevation: number
  availableHead: number
}

export interface DemoGeology {
  soilType: 'sand' | 'loam' | 'clay' | 'rock'
  groundwaterDepthM: number
  corrosivity: 'low' | 'medium' | 'high'
  freezingDepthM: number
}

export interface DemoSeismicity {
  siteIntensityPoints: number
  subsidenceProne: boolean
  floodProne: boolean
}

export interface DemoDataset {
  surveyPoints: SurveyPoint[]
  buildings: DemoBuilding[]
  source: DemoSource
  geology: DemoGeology
  seismicity: DemoSeismicity
}

const FLOORS_PATTERN = [2, 5, 3, 1, 4, 5, 2, 3, 1, 5] as const

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Smooth synthetic terrain, range roughly 95..103 m. */
export function demoElevation(x: number, y: number): number {
  const slope = 95 + x * 0.008
  const waves = 2.2 * Math.sin(x / 170) * Math.cos(y / 130)
  const hill = 1.5 * Math.exp(-((x - 480) ** 2 + (y - 320) ** 2) / (2 * 120 ** 2))
  return round2(slope + waves + hill)
}

export function createDemoDataset(): DemoDataset {
  const surveyPoints: SurveyPoint[] = []
  for (let x = 0; x <= 660; x += 30) {
    for (let y = 0; y <= 450; y += 30) {
      surveyPoints.push({ x, y, z: demoElevation(x, y) })
    }
  }

  const buildings: DemoBuilding[] = []
  let index = 0
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const floors = FLOORS_PATTERN[(row * 8 + col) % FLOORS_PATTERN.length]
      index++
      buildings.push({
        label: `Д${index}`,
        x: 90 + col * 70,
        y: 70 + row * 80,
        floors,
        residents: floors * 16,
      })
    }
  }

  const source: DemoSource = {
    x: 15,
    y: 225,
    groundElevation: demoElevation(15, 225),
    availableHead: 45,
  }

  return {
    surveyPoints,
    buildings,
    source,
    geology: {
      soilType: 'loam',
      groundwaterDepthM: 4,
      corrosivity: 'medium',
      freezingDepthM: 2.2,
    },
    seismicity: {
      siteIntensityPoints: 7,
      subsidenceProne: false,
      floodProne: false,
    },
  }
}

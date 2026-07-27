import {
  buildStormDemo,
  bindStormDemoBuildingIds,
  NORMATIVE_DEFAULTS,
  stormDemoAxisAt,
  stormDemoElevationAt,
  STORM_DEMO_STEP_M,
  STORM_DEMO_TOTAL_M,
} from '@aquascheme/engine'
import type { Borehole, CatalogItem, SurveyPoint, TracedNetwork } from '@aquascheme/engine'
import { supabase } from './supabase'
import { replaceNetwork, routeInputHash } from './network'
import { saveDataset } from './datasets'
import { insertParcel } from './parcels'
import { replaceGeology } from './geology'
import { deleteCatalog, fetchCatalogs, saveCatalog, setActiveCatalog } from './catalog'

export const DEMO_STORM_PROJECT_NAME = 'Учебный проект ливневого коллектора'

const DEMO_CORRIDOR = [
  { x: -140, y: -120 },
  { x: 200, y: -120 },
  { x: 200, y: STORM_DEMO_TOTAL_M + 120 },
  { x: -140, y: STORM_DEMO_TOTAL_M + 120 },
]

const DEMO_CATALOG: CatalogItem[] = [250, 315, 400, 500, 630, 800].map((dn) => ({
  itemType: 'pipe',
  material: 'Синтетический материал демо-каталога',
  dn,
}))

function demoSurveyPoints(): SurveyPoint[] {
  const points: SurveyPoint[] = []
  for (let station = 0; station <= STORM_DEMO_TOTAL_M; station += STORM_DEMO_STEP_M) {
    const axis = stormDemoAxisAt(station)
    const elevation = stormDemoElevationAt(station)
    points.push(
      { x: axis.x - 80, y: axis.y, z: elevation + 0.15 },
      { x: axis.x, y: axis.y, z: elevation },
      { x: axis.x + 80, y: axis.y, z: elevation - 0.1 },
    )
  }
  return points
}

function demoBoreholes(): Borehole[] {
  return [600, 1800].map((station, index) => {
    const point = stormDemoAxisAt(station)
    return {
      label: `Скважина D-${index + 1}`,
      x: point.x + 25,
      y: point.y,
      mouthElevationM: stormDemoElevationAt(station),
      layers: [
        { topDepthM: 0, bottomDepthM: 1.2, igeCode: 'D1', soilName: 'Синтетический суглинок' },
        { topDepthM: 1.2, bottomDepthM: 6, igeCode: 'D2', soilName: 'Синтетический песок' },
      ],
      water: { depthM: 3.5 },
    }
  })
}

export interface StormDemoResult {
  seededSections: number
  failures: string[]
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const item = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    const parts = [item.code, item.message, item.details, item.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (parts.length > 0) return parts.join(' · ')
    try {
      return JSON.stringify(error)
    } catch {
      return 'неизвестная ошибка объекта'
    }
  }
  return String(error)
}

/**
 * Seeds a synthetic project that exercises the complete UI without embedding
 * any acceptance-object values. The route is preliminary by design; only an
 * imported and classified survey/DWG may become a final engineering result.
 */
export async function seedStormProject(projectId: string, callbacks?: {
  onRouteProgress?: (stage: string) => void
  onRouteCancelReady?: (cancel: (() => void) | null) => void
}): Promise<StormDemoResult> {
  const failures: string[] = []
  let seededSections = 0
  const step = async (name: string, action: () => Promise<void>) => {
    try {
      await action()
      seededSections += 1
    } catch (error) {
      failures.push(`${name}: ${describeFailure(error)}`)
    }
  }

  callbacks?.onRouteCancelReady?.(null)
  callbacks?.onRouteProgress?.('Подготовка синтетической модели')
  const demo = buildStormDemo()
  let persistedNetwork: TracedNetwork | null = null
  const surveyPoints = demoSurveyPoints()
  const boreholes = demoBoreholes()
  const outlet = demo.network.nodes.find((node) => node.kind === 'source')

  await step('topography', () => saveDataset(projectId, 'topography', { points: surveyPoints }, {
    total: surveyPoints.length,
    accepted: surveyPoints.length,
    zMin: Math.min(...surveyPoints.map((point) => point.z)),
    zMax: Math.max(...surveyPoints.map((point) => point.z)),
    coordinateSystem: 'synthetic-local-demo',
  }, 'synthetic-demo.json'))

  await step('route constraints', () => saveDataset(projectId, 'route_constraints', {
    corridorRings: [DEMO_CORRIDOR],
    hardObstacleRings: [],
    surveyPoints,
    unresolvedLayers: [],
    georeference: { kind: 'local_anchor', source: 'synthetic local demo coordinates' },
    sourceDeclarations: {
      buildings: 'confirmed_absent',
      utilities: 'confirmed_absent',
      roads: 'confirmed_absent',
      hydrography: 'confirmed_absent',
      parcels: 'confirmed_absent',
      protectionZones: 'confirmed_absent',
    },
    completeness: 'synthetic-demo-only',
  }, { warning: 'Демо не является инженерными изысканиями и не допускает выпуск рабочей документации.' }))

  if (outlet) {
    await step('outlet', () => saveDataset(projectId, 'source', {
      x: outlet.x,
      y: outlet.y,
      groundElevation: outlet.groundElevation,
      availableHead: 0,
      label: 'Учебный выпуск',
    }, { source: 'synthetic-demo' }))
  }

  await step('region', () => saveDataset(projectId, 'region', {
    regionId: 'synthetic-demo',
    name: 'Условная территория',
    source: 'synthetic-demo',
    seismicPoints: 6,
    freezingDepthM: 1.8,
    hazards: [],
  }))

  await step('sources', async () => {
    const remove = await supabase.from('buildings').delete().eq('project_id', projectId)
    if (remove.error) throw remove.error
    const insert = await supabase
      .from('buildings')
      .insert(demo.sources.map((source) => ({
        project_id: projectId,
        label: source.label,
        x: source.x,
        y: source.y,
        floors: 1,
        residents: Math.round(source.flowLps),
        specific_demand_lpd: null,
        design_flow_lps: source.flowLps,
      })))
      .select('id,x,y')
    if (insert.error) throw insert.error
    persistedNetwork = bindStormDemoBuildingIds(
      demo.network,
      (insert.data ?? []) as Array<{ id: string; x: number; y: number }>,
    )
  })

  await step('geology summary', () => saveDataset(projectId, 'geology', {
    soilType: 'loam',
    groundwaterDepthM: 3.5,
    corrosivity: 'unknown',
    freezingDepthM: 1.8,
    sourceFile: 'synthetic-demo.json',
    synthetic: true,
  }))
  await step('boreholes', () => replaceGeology(projectId, boreholes))
  await step('seismic', () => saveDataset(projectId, 'seismic', { siteIntensityPoints: 6, synthetic: true }))
  await step('norms', () => saveDataset(projectId, 'normative', { ...NORMATIVE_DEFAULTS, demoOnly: true }))

  await step('parcels', async () => {
    const remove = await supabase.from('parcels').delete().eq('project_id', projectId)
    if (remove.error) throw remove.error
    await insertParcel(projectId, 'right_of_way', DEMO_CORRIDOR, 'Синтетический учебный коридор')
  })

  await step('catalog', async () => {
    for (const catalog of await fetchCatalogs(projectId)) await deleteCatalog(projectId, catalog.id)
    const id = await saveCatalog(projectId, 'Синтетический демо-каталог', 'synthetic-demo.csv', DEMO_CATALOG)
    await setActiveCatalog(projectId, id)
  })

  await step('basis', () => saveDataset(projectId, 'basis', {
    files: {},
    mode: 'synthetic',
    note: 'Исходные документы намеренно не отмечены загруженными: демо не заменяет реальные ТЗ, АПЗ, DWG, топосъёмку и ИГИ.',
  }))

  callbacks?.onRouteProgress?.('Сохранение синтетической трассы')
  await step('engineering route', async () => {
    if (!persistedNetwork) throw new Error('Здания-источники не сохранены; сеть не отправлена в базу.')
    const inputHash = await routeInputHash({ network: persistedNetwork, surveyPoints, corridor: DEMO_CORRIDOR })
    await replaceNetwork(projectId, persistedNetwork, {
      status: 'preliminary',
      inputHash,
      warnings: ['Синтетическая демонстрация: для инженерного выпуска импортируйте реальные исходные данные.'],
      report: {
        synthetic: true,
        quality: { totalLengthM: persistedNetwork.totalLengthM, routedTerminals: demo.sources.length, outsideCorridorSegments: 0 },
      },
    })
  })

  callbacks?.onRouteProgress?.('Готово')
  return { seededSections, failures }
}

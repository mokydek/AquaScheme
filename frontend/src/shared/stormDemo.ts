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
import { ringToGeometry } from './parcels'
import { replaceGeology } from './geology'
import {
  deleteCatalog,
  fetchCatalogs,
  loadActiveCatalogNominalDiameters,
  saveCatalog,
  setActiveCatalog,
} from './catalog'
import { formatAppError } from './errorFormatting'
import { mergeSyntheticBasisContents } from './basisDemo'
import { buildSyntheticStormPlanContext } from './stormDemoPlanContext'

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
      { x: axis.x - 45, y: axis.y, z: elevation + 0.15 },
      { x: axis.x, y: axis.y, z: elevation },
      { x: axis.x + 45, y: axis.y, z: elevation - 0.1 },
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
  /** True only when every section and the engineering route were persisted. */
  ready: boolean
}

async function markDemoSeedBlocked(projectId: string, failures: readonly string[]): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      route_status: 'blocked',
      route_blockers: failures.map((message) => ({
        code: 'DEMO_SEED_INCOMPLETE',
        scope: 'synthetic-demo',
        message,
      })),
      route_warnings: ['Синтетическое демо загружено не полностью; гидравлический расчёт отключён.'],
      route_report: { synthetic: true, seedReady: false },
    })
    .eq('id', projectId)
  if (error) throw error
}

/**
 * Seeds a synthetic project that exercises the complete UI without embedding
 * any acceptance-object values. The route is preliminary by design; only an
 * imported and classified survey/DWG may become a final engineering result.
 */
/**
 * Учебный каталог конструкций колодцев: три типа по глубине.
 *
 * Диапазоны перекрываются встык и покрывают демо-профиль целиком, иначе часть
 * колодцев осталась бы без конструкции и ведомость показала бы пробел. Всё
 * синтетическое: типоразмеры условные, к производству не допускаются.
 */
const DEMO_MANHOLE_CATALOG = [
  {
    typeCode: 'КС-10 (демо)',
    minPipeDiameterMm: 150, maxPipeDiameterMm: 400,
    minDepthM: 0, maxDepthM: 3,
    chamberDiameterMm: 1000,
    components: [],
    source: 'synthetic-demo: учебный каталог конструкций',
    verified: false,
  },
  {
    typeCode: 'КС-15 (демо)',
    minPipeDiameterMm: 150, maxPipeDiameterMm: 600,
    minDepthM: 3, maxDepthM: 5,
    chamberDiameterMm: 1500,
    components: [],
    source: 'synthetic-demo: учебный каталог конструкций',
    verified: false,
  },
  {
    typeCode: 'КС-20 (демо)',
    minPipeDiameterMm: 150, maxPipeDiameterMm: 1200,
    minDepthM: 5, maxDepthM: 8,
    chamberDiameterMm: 2000,
    components: [],
    source: 'synthetic-demo: учебный каталог конструкций',
    verified: false,
  },
] as const

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
      failures.push(`${name}: ${formatAppError(error)}`)
    }
  }

  callbacks?.onRouteCancelReady?.(null)
  callbacks?.onRouteProgress?.('Подготовка синтетической модели')
  const demo = buildStormDemo()
  let persistedNetwork: TracedNetwork | null = null
  const surveyPoints = demoSurveyPoints()
  const planContext = buildSyntheticStormPlanContext()
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
    ...planContext,
    unresolvedLayers: [],
    georeference: { kind: 'local_anchor', source: 'synthetic local demo coordinates' },
    sourceDeclarations: {
      buildings: 'confirmed_absent',
      utilities: 'confirmed_absent',
      roads: 'present',
      hydrography: 'confirmed_absent',
      parcels: 'confirmed_absent',
      protectionZones: 'confirmed_absent',
    },
    completeness: 'synthetic-demo-only',
    /**
     * Состав комплекта демо: подтверждён учебным заданием.
     *
     * Один этот пробел держал 13 листов из 16 стоп-фактором
     * DELIVERABLE_REQUIREMENTS_MISSING. Состав — вход задания, а не вывод
     * расчёта, и в учебном наборе он объявляется прямо: отдельных листов
     * пересечений и защитной сетки демо не выпускает, профиль по бассейнам,
     * напорная перемычка на том же листе.
     */
    deliverableRequirements: {
      crossingDetailSheets: false,
      protectiveGridDetail: false,
      existingSectionProfile: false,
      basinProfileLayout: 'per_basin',
      pressureLinkSheets: 'same_sheet',
      source: 'synthetic-demo: учебное задание на состав комплекта',
      verified: true,
    },
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
    const existing = await supabase.from('buildings').select('id').eq('project_id', projectId)
    if (existing.error) throw existing.error
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
    const insertedRows = (insert.data ?? []) as Array<{ id: string; x: number; y: number }>
    persistedNetwork = bindStormDemoBuildingIds(
      demo.network,
      insertedRows,
    )
    const previousIds = (existing.data ?? []).map((row) => row.id)
    if (previousIds.length > 0) {
      const remove = await supabase.from('buildings').delete().in('id', previousIds)
      if (remove.error) {
        const insertedIds = insertedRows.map((row) => row.id)
        if (insertedIds.length > 0) await supabase.from('buildings').delete().in('id', insertedIds)
        persistedNetwork = null
        throw remove.error
      }
    }
  })

  /**
   * Геология демо: величина ЗАДАНА, подписана источником и подтверждена.
   *
   * Раньше подтверждения не было вовсе, и демо получало стоп-фактор «глубина
   * промерзания не подтверждена». Причина при этом называлась неверно:
   * величина в учебном наборе есть и однозначна, а к выпуску набор не
   * допускает признак `synthetic`, а не отсутствие подтверждения.
   *
   * Промерзание одно, без выбора из кандидатов: демо показывает продукт, а не
   * упражнение по разбору противоречивого отчёта.
   */
  await step('geology summary', () => saveDataset(projectId, 'geology', {
    soilType: 'loam',
    groundwaterDepthM: 3.5,
    corrosivity: 'unknown',
    freezingDepthM: 1.8,
    freezingDepthSource: 'synthetic-demo: учебный набор, СН РК 2.04-01-2017 прил. 2 (значение условное)',
    freezingDepthVerified: true,
    // Допуск удаления скважины от трассы: правило пространственного покрытия.
    geologyCoverage: {
      maxOffsetM: 120,
      status: 'verified',
      source: 'synthetic-demo: учебное правило покрытия',
    },
    sourceFile: 'synthetic-demo.json',
    synthetic: true,
  }))
  await step('boreholes', () => replaceGeology(projectId, boreholes))
  await step('seismic', () => saveDataset(projectId, 'seismic', { siteIntensityPoints: 6, synthetic: true }))
  await step('norms', () => saveDataset(projectId, 'normative', { ...NORMATIVE_DEFAULTS, demoOnly: true }))

  /**
   * Каталог конструкций колодцев.
   *
   * Без него разбивка на бассейны не считается вовсе: предел глубины берётся
   * отсюда, и «осуществимость самотёка» оставалась неоценённой. Структура — та
   * же, что у каталога коллектора: тип, диапазон диаметров трубы, диапазон
   * глубин, диаметр камеры.
   */
  await step('manhole catalog', () => saveDataset(projectId, 'manhole_catalog', {
    entries: DEMO_MANHOLE_CATALOG,
    synthetic: true,
  }, { entries: DEMO_MANHOLE_CATALOG.length }, 'synthetic-demo-manholes.json'))

  await step('parcels', async () => {
    const existing = await supabase.from('parcels').select('id').eq('project_id', projectId)
    if (existing.error) throw existing.error
    const insert = await supabase.from('parcels').insert({
      project_id: projectId,
      kind: 'right_of_way',
      label: 'Синтетический учебный коридор',
      geometry: ringToGeometry(DEMO_CORRIDOR),
    }).select('id')
    if (insert.error) throw insert.error
    const insertedId = insert.data?.[0]?.id
    const previousIds = (existing.data ?? []).map((row) => row.id)
    if (previousIds.length > 0) {
      const remove = await supabase.from('parcels').delete().in('id', previousIds)
      if (remove.error) {
        if (insertedId) await supabase.from('parcels').delete().eq('id', insertedId)
        throw remove.error
      }
    }
  })

  await step('catalog', async () => {
    const previousCatalogs = await fetchCatalogs(projectId)
    let id: string | null = null
    try {
      id = await saveCatalog(projectId, 'Синтетический демо-каталог', 'synthetic-demo.csv', DEMO_CATALOG)
      const diameters = await loadActiveCatalogNominalDiameters(id)
      if (!diameters?.length) {
        throw new Error('Сохранённый демо-каталог не содержит труб с положительным DN.')
      }
      await setActiveCatalog(projectId, id)
      for (const catalog of previousCatalogs) {
        if (catalog.id !== id) {
          try {
            await deleteCatalog(projectId, catalog.id)
          } catch {
            // The replacement is already validated and active. Keeping an old
            // inactive catalog is safer than rolling back to a deleted target.
          }
        }
      }
    } catch (error) {
      if (id) {
        try {
          await deleteCatalog(projectId, id)
        } catch {
          // Preserve the original, more useful catalog failure in the report.
        }
      }
      throw error
    }
  })

  await step('basis', async () => {
    const existing = await supabase
      .from('datasets')
      .select('content')
      .eq('project_id', projectId)
      .eq('kind', 'basis')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (existing.error) throw existing.error
    const contents = (existing.data ?? []).map((row) => row.content)
    await saveDataset(projectId, 'basis', mergeSyntheticBasisContents(contents))
  })

  callbacks?.onRouteProgress?.('Сохранение синтетической трассы')
  if (failures.length === 0) {
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
  } else {
    failures.push('engineering route: не сохранена, потому что один или несколько разделов демо не загрузились.')
  }

  if (failures.length > 0) {
    try {
      await markDemoSeedBlocked(projectId, failures)
    } catch (error) {
      failures.push(`seed status: ${formatAppError(error)}`)
    }
  }

  const ready = failures.length === 0
  callbacks?.onRouteProgress?.(ready ? 'Готово' : 'Загрузка остановлена: исправьте ошибки разделов')
  return { seededSections, failures, ready }
}

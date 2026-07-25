import { NORMATIVE_DEFAULTS, traceConstrainedNetwork } from '@aquascheme/engine'
import type { CatalogItem, TracedNetwork } from '@aquascheme/engine'
import { supabase } from './supabase'
import { replaceNetwork } from './network'
import { saveDataset } from './datasets'
import { insertParcel } from './parcels'
import { replaceGeology } from './geology'
import { deleteCatalog, fetchCatalogs, saveCatalog, setActiveCatalog } from './catalog'
import { BASIS_ITEMS } from '../app/project/BasisSection'
import realProject from './realProjectData.json'

export const REAL_STORM_PROJECT_NAME = realProject.project.name

/**
 * One-click storm demo that seeds a WHOLE ready project — not just the network
 * — so the user can open the finished result (the full sheet set) and see the
 * gaps in one place. It fills every panel: inflow sources, the trunk network,
 * geology (the report summary), seismicity, norms,
 * the land-allocation corridor, and the permitting-documents checklist.
 *
 * The binary PDFs/DWG remain in private project storage. The bundle contains
 * only compact, reviewable facts extracted from them: drawing coordinates and
 * elevations, the right-of-way ring, design flows, geology and specification.
 * Every
 * step runs independently so a missing migration for one table never blocks
 * the rest, and the count of seeded sections is returned.
 */

/** Names of the reference input documents (no binaries), for the checklist. */
const BASIS_DEMO_FILES: Partial<Record<string, string>> = {
  assignment: 'ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf — общие данные и основание проектирования',
  apz: 'АПЗ исправленный 22,10.pdf',
  pdp: 'ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf — планы трассы, листы 3–31',
  route_act: 'ТОО Аква Д.большой Талдыколь общий.dwg — инженерный коридор и топографическая основа',
  genplan_scheme: 'Схема ЛК от Генплан с диаметрами..pdf',
  topo: 'Топо Водосбрсной общий 15,10.pdf',
  geology: 'Геологоия по замечаниям Арх. №17-08-25. 19,01,26,.pdf',
  vertical: 'Топо Водосбрсной общий 15,10.pdf + DWG — высотные отметки и вертикальная планировка',
  tu: 'АПЗ исправленный 22,10.pdf — исходные технические требования',
}

/** Every file supplied for verification; names only, never bundled binaries. */
export const STORM_REFERENCE_FILES = [
  'АПЗ исправленный 22,10.pdf',
  'Схема ЛК от Генплан с диаметрами..pdf',
  'Геологоия по замечаниям Арх. №17-08-25. 19,01,26,.pdf',
  'ТОО Аква Д.большой Талдыколь общий.dwg',
  'Топо Водосбрсной общий 15,10.pdf',
  'aquascheme_geology_template.xlsx',
  'Земельный кодекс.pdf',
  '_Экологический кодекс РК 09.01.2026.pdf',
  '_Строительный кодекс РК 09.01.2026.pdf',
  '_Водный кодекс РК 12.03.2026.pdf',
  '4_СН РК 4.01_03_2013 Водоотведение. Наружные сети и сооружения. (с изм. от 07.11.2019г) (1).pdf',
  '4_СН РК 4.01_03_2013 Водоотведение. Наружные сети и сооружения. (с изм. от 07.11.2019г).pdf',
  '4_01_03_2011.pdf',
  'SP_RK_4.01-103-2013.pdf',
  'СН_РК_1.02-03-2022 (с изм 2025) (1).pdf',
  'СН_РК_1.02-03-2022 (с изм 2025).pdf',
  'ГОСТ 21.704-2011 Правила выполнения ПСД НВК.pdf',
  'ГОСТ 21.101-2020. Основные требования к проектной и рабочей документации.pdf',
  'ГОСТ 21.110-2013 спецификации.pdf',
  'АГСК 3 RU (по состоянию на 3 апреля 2026 года).pdf',
  'ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf',
] as const

export async function seedBasisDemo(projectId: string): Promise<void> {
  const files: Record<string, string> = {}
  for (const item of BASIS_ITEMS) {
    const file = BASIS_DEMO_FILES[item.id]
    if (file) files[item.id] = file
  }
  await saveDataset(projectId, 'basis', {
    files,
    referenceFiles: [...STORM_REFERENCE_FILES],
    mode: 'demo-derived',
    project: realProject.project,
    designSchedule: realProject.designSchedule,
    provenance: {
      apz: 'АПЗ №145200 от 22.10.2025',
      drawing: 'ТОО Аква Д.большой Талдыколь общий.dwg',
      geology: 'Арх. №17-08/25',
      finalAlbum: '2024-51-НК, том 2, альбом 1, листы 1–3 спецификации',
    },
  })
}

function nearestElevation(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  let elevation = 340
  for (const point of realProject.surveyPoints) {
    if (point.z < 300 || point.z > 400) continue
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2
    if (distance < best) {
      best = distance
      elevation = point.z
    }
  }
  return elevation
}

function realNetwork(buildingIdByLabel: Map<string, string>): TracedNetwork {
  const result = traceConstrainedNetwork(
    realProject.inflows.map((inflow, index) => ({
      id: inflow.label,
      buildingId: buildingIdByLabel.get(inflow.label) ?? `ОС-${index + 1}`,
      x: inflow.x,
      y: inflow.y,
    })),
    realProject.outlet,
    {
      corridorRings: [realProject.corridor],
      surveyPoints: realProject.surveyPoints.filter((point) => point.z >= 300 && point.z <= 400),
    },
    { gridSizeM: 15 },
  )
  if (!result.report.ok) throw new Error(result.report.warnings.join(' '))
  return result.network
}

const REAL_CATALOG: CatalogItem[] = [
  { itemType: 'pipe', material: 'Железобетон, ТС 200.25-4', standard: 'ГОСТ 6482-2011', dn: 2000 },
  { itemType: 'pipe', material: 'Железобетон, ТС 200.25-5', standard: 'ГОСТ 6482-2011', dn: 2000 },
  { itemType: 'pipe', material: 'Железобетон, ТС 160.25-4', standard: 'ГОСТ 6482-2011', dn: 1600 },
  { itemType: 'pipe', material: 'Железобетон, ТС 120.25-4', standard: 'ГОСТ 6482-2011', dn: 1200 },
  { itemType: 'pipe', material: 'Полимерная спиральновитая SN12', standard: 'СТ РК 33813-2022', dn: 2000 },
  { itemType: 'pipe', material: 'ПЭ100 SDR17', standard: 'ГОСТ 18599-2001', dn: 800, outerMm: 800, wallMm: 47.4, sdr: 17 },
  { itemType: 'pipe', material: 'ПЭ100 SDR17', standard: 'ГОСТ 18599-2001', dn: 560, outerMm: 560, sdr: 17 },
  { itemType: 'pipe', material: 'Сталь, футляр 2500×20', standard: 'ГОСТ 10704-91', dn: 2500, outerMm: 2500, wallMm: 20 },
]

export interface StormDemoResult {
  seededSections: number
  failures: string[]
}

export async function seedStormProject(projectId: string): Promise<StormDemoResult> {
  const failures: string[] = []
  let seeded = 0
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      seeded++
    } catch {
      failures.push(name)
    }
  }

  // Real drawing points. The DWG contains 3193 points on layer «точки»;
  // a deterministic 1:5 sample is bundled to keep the web payload reasonable.
  await step('topography', () => {
    const points = realProject.surveyPoints.filter((point) => point.z >= 300 && point.z <= 400)
    const z = points.map((point) => point.z)
    return saveDataset(projectId, 'topography', { points }, {
      total: realProject.sourceSurveyPointCount,
      accepted: points.length,
      zMin: Math.min(...z),
      zMax: Math.max(...z),
      sampledEvery: 5,
      coordinateSystem: 'локальные координаты исходного DWG',
      derivedFrom: ['Топо Водосбрсной общий 15,10.pdf', 'ТОО Аква Д.большой Талдыколь общий.dwg'],
    }, 'ТОО Аква Д.большой Талдыколь общий.dwg')
  })
  await step('outlet', () => {
    return saveDataset(projectId, 'source', {
      x: realProject.outlet.x,
      y: realProject.outlet.y,
      groundElevation: nearestElevation(realProject.outlet.x, realProject.outlet.y),
      availableHead: 0,
      label: realProject.outlet.label,
    }, { derivedFrom: ['Схема ЛК от Генплан с диаметрами..pdf', 'ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf'] })
  })
  await step('region', () => saveDataset(projectId, 'region', {
    regionId: 'astana',
    name: 'г. Астана',
    source: 'manual',
    seismicPoints: 6,
    freezingDepthM: 2.53,
    hazards: ['high_groundwater'],
  }))

  // Inflow sources. The route is calculated from the DWG engineering corridor,
  // not copied from the accepted album. Exact decimal design flow is stored in
  // specific_demand_lpd because the legacy residents column is integer.
  await step('sources', async () => {
    await supabase.from('buildings').delete().eq('project_id', projectId)
    const { data: inserted, error } = await supabase
      .from('buildings')
      .insert(realProject.inflows.map((source) => ({
        project_id: projectId,
        label: source.label,
        x: source.x,
        y: source.y,
        floors: 1,
        residents: Math.round(source.flowLps),
        specific_demand_lpd: source.flowLps,
      })))
      .select('id,label')
    if (error) throw error
    const idByLabel = new Map((inserted ?? []).map((r: { id: string; label: string }) => [r.label, r.id]))
    await replaceNetwork(projectId, realNetwork(idByLabel))
  })

  // Geology is a report-level summary. The supplied XLSX is only a template,
  // so its sample С-1/С-2 rows must never be presented as real boreholes.
  await step('geology', () =>
    saveDataset(projectId, 'geology', {
      soilType: 'clay',
      groundwaterDepthM: realProject.geology.groundwaterDepthM.min,
      groundwaterRangeM: realProject.geology.groundwaterDepthM,
      groundwaterElevationM: realProject.geology.groundwaterElevationM,
      groundwaterDesignRiseM: realProject.geology.designRiseM,
      corrosivity: realProject.geology.corrosivity,
      freezingDepthM: realProject.geology.freezingDepthM,
      subsidenceType: null,
      heaving: false,
      swelling: false,
      reportIge: realProject.geology.ige,
      sourceFile: 'Геологоия по замечаниям Арх. №17-08-25. 19,01,26,.pdf',
      sourceArchiveNumber: '17-08/25',
    }),
  )
  await step('boreholes', () => replaceGeology(projectId, []))

  // 3. Seismicity and norms.
  await step('seismic', () => saveDataset(projectId, 'seismic', { siteIntensityPoints: 6 }))
  await step('norms', () => saveDataset(projectId, 'normative', { ...NORMATIVE_DEFAULTS }))

  // The actual closed right-of-way polyline from the DWG, simplified at 8 m.
  await step('parcels', async () => {
    await supabase.from('parcels').delete().eq('project_id', projectId)
    await insertParcel(projectId, 'right_of_way', realProject.corridor, 'Коридор инженерных сетей из исходного DWG')
  })

  await step('catalog', async () => {
    for (const catalog of await fetchCatalogs(projectId)) await deleteCatalog(projectId, catalog.id)
    const catalogId = await saveCatalog(
      projectId,
      '2024-51-НК.С — спецификация листы 1–3',
      'ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf',
      REAL_CATALOG,
    )
    await setActiveCatalog(projectId, catalogId)
  })

  // Permitting checklist + exact schedule and project card.
  await step('basis', () => seedBasisDemo(projectId))

  return { seededSections: seeded, failures }
}

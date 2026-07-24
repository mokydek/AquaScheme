import { buildStormDemo, NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { Borehole } from '@aquascheme/engine'
import { supabase } from './supabase'
import { replaceNetwork } from './network'
import { saveDataset } from './datasets'
import { insertParcel } from './parcels'
import { replaceGeology } from './geology'
import { BASIS_ITEMS } from '../app/project/BasisSection'

/**
 * One-click storm demo that seeds a WHOLE ready project — not just the network
 * — so the user can open the finished result (the full sheet set) and see the
 * gaps in one place. It fills every panel: inflow sources, the trunk network,
 * geology (summary + demo boreholes for the cross-section), seismicity, norms,
 * the land-allocation corridor, and the permitting-documents checklist.
 *
 * The real object's source PDFs/DWG are private and must not ship inside the
 * public JavaScript bundle, so the checklist is seeded with the exact file
 * manifest and reviewable derived facts — the binary files stay in private
 * project storage when the owner attaches them; every
 * step runs independently so a missing migration for one table never blocks
 * the rest, and the count of seeded sections is returned.
 */

/** Names of the reference input documents (no binaries), for the checklist. */
const BASIS_DEMO_FILES: Record<string, string> = {
  assignment: 'ТЗ — требуется прикрепить оригинал',
  apz: 'АПЗ исправленный 22,10.pdf',
  pdp: 'ПДП — требуется прикрепить оригинал',
  route_act: 'Акт выбора трассы — требуется прикрепить оригинал',
  genplan_scheme: 'Схема ЛК от Генплан с диаметрами..pdf',
  topo: 'Топо Водосбрсной общий 15,10.pdf',
  geology: 'Геологоия по замечаниям Арх. №17-08-25. 19,01,26,.pdf',
  vertical: 'Вертикальная планировка — требуется прикрепить оригинал',
  tu: 'Технические условия — требуется прикрепить оригинал',
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
  for (const item of BASIS_ITEMS) files[item.id] = BASIS_DEMO_FILES[item.id] ?? `${item.id} (демо)`
  await saveDataset(projectId, 'basis', {
    files,
    referenceFiles: [...STORM_REFERENCE_FILES],
    mode: 'demo-derived',
  })
}

/** Two demo boreholes so the geology cross-section draws on the profile. */
function demoBoreholes(y0: number, y1: number): Borehole[] {
  const layers = [
    { igeCode: '1', soilName: 'насыпной суглинок', topDepthM: 0, bottomDepthM: 2.5, frictionAngleDeg: 21, cohesionKpa: 24, deformationModulusMpa: 14, filtrationMDay: 0.1 },
    { igeCode: '3', soilName: 'песок средней крупности, насыщенный водой', topDepthM: 2.5, bottomDepthM: 8, frictionAngleDeg: 32, cohesionKpa: 2, deformationModulusMpa: 28, filtrationMDay: 5 },
  ]
  return [
    { label: 'С-1', x: 60, y: y0, mouthElevationM: 100, layers: [...layers], water: { depthM: 0.5, aggressivenessSteel: 'high', aggressivenessConcrete: 'medium', aggressivenessPe: 'low' } },
    { label: 'С-2', x: 60, y: (y0 + y1) / 2, mouthElevationM: 96, layers: [...layers], water: { depthM: 1.2, aggressivenessSteel: 'high' } },
    { label: 'С-3', x: 60, y: y1, mouthElevationM: 92.1, layers: [...layers], water: { depthM: 2.4, aggressivenessSteel: 'high' } },
  ]
}

export interface StormDemoResult {
  seededSections: number
  failures: string[]
}

export async function seedStormProject(projectId: string): Promise<StormDemoResult> {
  const demo = buildStormDemo()
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

  const ys = demo.network.nodes.filter((n) => n.kind !== 'building').map((n) => n.y)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)

  // Survey/profile points and the downstream outlet are derived from the
  // benchmark route so all input panels are usable immediately.
  await step('topography', () => {
    const points = demo.network.nodes
      .filter((node) => node.kind !== 'building')
      .map((node) => ({ x: node.x, y: node.y, z: node.groundElevation }))
    const z = points.map((point) => point.z)
    return saveDataset(projectId, 'topography', { points }, {
      total: points.length,
      accepted: points.length,
      zMin: Math.min(...z),
      zMax: Math.max(...z),
      derivedFrom: ['Топо Водосбрсной общий 15,10.pdf', 'ТОО Аква Д.большой Талдыколь общий.dwg'],
    }, 'демо: производные точки трассы')
  })
  await step('outlet', () => {
    const outlet = demo.network.nodes.find((node) => node.kind === 'source')
    if (!outlet) throw new Error('demo outlet missing')
    return saveDataset(projectId, 'source', {
      x: outlet.x,
      y: outlet.y,
      groundElevation: outlet.groundElevation,
      availableHead: 0,
    }, { derivedFrom: 'Схема ЛК от Генплан с диаметрами..pdf' })
  })
  await step('region', () => saveDataset(projectId, 'region', {
    regionId: 'astana',
    name: 'г. Астана',
    source: 'manual',
    seismicPoints: 6,
    freezingDepthM: 2.53,
    hazards: ['high_groundwater'],
  }))

  // 1. Inflow sources (ОС) + network.
  await step('sources', async () => {
    await supabase.from('buildings').delete().eq('project_id', projectId)
    const { data: inserted, error } = await supabase
      .from('buildings')
      .insert(demo.sources.map((s) => ({ project_id: projectId, label: s.label, x: s.x, y: s.y, floors: 1, residents: s.flowLps })))
      .select('id,label')
    if (error) throw error
    const idByLabel = new Map((inserted ?? []).map((r: { id: string; label: string }) => [r.label, r.id]))
    const network = {
      ...demo.network,
      nodes: demo.network.nodes.map((n) =>
        n.kind === 'building' ? { ...n, buildingId: idByLabel.get(`ОС-${n.id.slice(2)}`) ?? n.buildingId } : n,
      ),
    }
    await replaceNetwork(projectId, network)
  })

  // 2. Geology: summary + demo boreholes.
  await step('geology', () =>
    saveDataset(projectId, 'geology', {
      soilType: 'clay',
      groundwaterDepthM: 0.5,
      corrosivity: 'high',
      freezingDepthM: 2.53,
      subsidenceType: null,
      heaving: true,
      swelling: true,
    }),
  )
  await step('boreholes', () => replaceGeology(projectId, demoBoreholes(y0, y1)))

  // 3. Seismicity and norms.
  await step('seismic', () => saveDataset(projectId, 'seismic', { siteIntensityPoints: 6 }))
  await step('norms', () => saveDataset(projectId, 'normative', { ...NORMATIVE_DEFAULTS }))

  // 4. Land allocation: a parcel and the right-of-way corridor.
  await step('parcels', async () => {
    await supabase.from('parcels').delete().eq('project_id', projectId)
    await insertParcel(projectId, 'right_of_way', [
      { x: -40, y: y0 - 40 },
      { x: 40, y: y0 - 40 },
      { x: 40, y: y1 + 40 },
      { x: -40, y: y1 + 40 },
    ], 'Полоса отвода (демо)')
    await insertParcel(projectId, 'parcel', [
      { x: 40, y: y0 - 20 },
      { x: 120, y: y0 - 20 },
      { x: 120, y: y0 + 60 },
      { x: 40, y: y0 + 60 },
    ], 'Участок ОС-1 (демо)')
  })

  // 5. Permitting documents checklist (names only — binaries stay local).
  await step('basis', () => seedBasisDemo(projectId))

  return { seededSections: seeded, failures }
}

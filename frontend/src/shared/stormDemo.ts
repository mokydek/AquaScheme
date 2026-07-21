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
 * The real object's source PDFs (ТЗ, АПЗ, ПДП, …) are confidential and must
 * not ship in the public repo, so the checklist is seeded with the document
 * NAMES marked «(демо)» — the binary files stay the user's to attach; every
 * step runs independently so a missing migration for one table never blocks
 * the rest, and the count of seeded sections is returned.
 */

/** Names of the reference input documents (no binaries), for the checklist. */
const BASIS_DEMO_FILES: Record<string, string> = {
  assignment: 'ТЗ_водосбросной_коллектор (демо).pdf',
  apz: 'АПЗ_№145200 (демо).pdf',
  pdp: 'ПДП_водосбросной_2025 (демо).pdf',
  route_act: 'Акт_выбора_трассы_2025 (демо).pdf',
  genplan_scheme: 'Схема_ЛК_с_диаметрами (демо).pdf',
  topo: 'Топосъёмка_М1-500 (демо).pdf',
  geology: 'Отчёт_ИГИ (демо).pdf',
  vertical: 'Вертикальная_планировка (демо).pdf',
  tu: 'Технические_условия (демо).pdf',
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
      freezingDepthM: 2.2,
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
  await step('basis', () => {
    const files: Record<string, string> = {}
    for (const item of BASIS_ITEMS) files[item.id] = BASIS_DEMO_FILES[item.id] ?? `${item.id} (демо)`
    return saveDataset(projectId, 'basis', { files })
  })

  return { seededSections: seeded, failures }
}

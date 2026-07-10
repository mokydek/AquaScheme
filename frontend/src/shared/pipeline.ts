import { MATERIAL_LABELS, placeFittings, selectMaterials, traceNetwork } from '@aquascheme/engine'
import type {
  GeologyInput,
  NormativeParams,
  SeismicInput,
  SurveyPoint,
  TracedNetwork,
} from '@aquascheme/engine'
import type { SizingInput, SizingResult } from '@aquascheme/engine/sizing'
import type { HydraulicsWorkerResponse } from '../workers/hydraulics.worker'
import { supabase } from './supabase'
import { networkFromRows, replaceNetwork } from './network'
import type { NodeRow, PipeRow } from './network'

/** Run the EPANET sizing loop in the hydraulics worker. */
export function runSizingInWorker(input: SizingInput): Promise<SizingResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/hydraulics.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<HydraulicsWorkerResponse>) => {
      worker.terminate()
      const response = event.data
      if (response.ok) resolve(response.result)
      else reject(new Error(response.error))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('hydraulics worker failed'))
    }
    worker.postMessage(input)
  })
}

/** Fetch the persisted network rows of a project. */
export async function fetchNetworkRows(
  projectId: string,
): Promise<{ nodes: NodeRow[]; pipes: PipeRow[] }> {
  const [nodesRes, pipesRes] = await Promise.all([
    supabase
      .from('nodes')
      .select('id,kind,label,x,y,ground_elevation,building_id,meta')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('pipes')
      .select('id,from_node,to_node,length_m,diameter_mm,material,meta')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ])
  return {
    nodes: (nodesRes.data ?? []) as NodeRow[],
    pipes: (pipesRes.data ?? []) as PipeRow[],
  }
}

/** Persist a sizing result onto the pipes, nodes and a new calc run. */
export async function persistSizing(
  projectId: string,
  result: SizingResult,
  nodes: NodeRow[],
  pipes: PipeRow[],
  norms: NormativeParams,
  availableHeadM: number,
  isoTimestamp: string,
): Promise<void> {
  const pipeByEngineId = new Map(pipes.map((p) => [p.meta?.engineId ?? '', p]))
  const pipeUpdates = result.pipes.flatMap((rp) => {
    const row = pipeByEngineId.get(rp.id)
    if (!row) return []
    return [
      {
        id: row.id,
        project_id: projectId,
        from_node: row.from_node,
        to_node: row.to_node,
        length_m: row.length_m,
        diameter_mm: rp.nominalMm,
        material: 'ПЭ100 SDR17',
        meta: {
          ...row.meta,
          kind: rp.kind,
          engineId: rp.id,
          flowLps: rp.flowLps,
          velocityMs: rp.velocityMs,
          headlossM: rp.headlossM,
          internalMm: rp.internalMm,
        },
      },
    ]
  })
  const pipesUpsert = await supabase.from('pipes').upsert(pipeUpdates)
  if (pipesUpsert.error) throw pipesUpsert.error

  const nodeByLabel = new Map(nodes.map((n) => [n.label ?? '', n]))
  const nodeUpdates = result.nodes.flatMap((rn) => {
    const row = nodeByLabel.get(rn.id)
    if (!row) return []
    return [
      {
        id: row.id,
        project_id: projectId,
        kind: row.kind,
        label: row.label,
        x: row.x,
        y: row.y,
        ground_elevation: row.ground_elevation,
        building_id: row.building_id,
        meta: {
          ...row.meta,
          pressureM: rn.pressureM,
          headM: rn.headM,
          requiredPressureM: rn.requiredPressureM ?? null,
          ok: rn.ok,
        },
      },
    ]
  })
  const nodesUpsert = await supabase.from('nodes').upsert(nodeUpdates)
  if (nodesUpsert.error) throw nodesUpsert.error

  const runInsert = await supabase.from('calc_runs').insert({
    project_id: projectId,
    status: 'done',
    params: { ...norms, availableHeadM },
    summary: result as unknown as Record<string, unknown>,
    finished_at: isoTimestamp,
  })
  if (runInsert.error) throw runInsert.error
}

export type EquipmentPersistResult = { ok: true } | { ok: false; reason: 'migrationNeeded' | 'error' }

/** Select materials, place fittings and persist them onto the project. */
export async function persistEquipment(
  projectId: string,
  network: TracedNetwork,
  nodes: NodeRow[],
  geology: GeologyInput,
  seismicity: SeismicInput,
  sizing: SizingResult | null,
): Promise<EquipmentPersistResult> {
  try {
    const elevations = network.nodes.map((n) => n.groundElevation)
    const fallbackPressure =
      45 + (elevations.length > 0 ? Math.max(...elevations) - Math.min(...elevations) : 0)
    const maxPressureM = sizing
      ? Math.max(...sizing.nodes.filter((n) => n.kind !== 'source').map((n) => n.pressureM))
      : fallbackPressure

    const material = selectMaterials({ geology, seismicity, maxPressureM })
    const fittings = placeFittings(network)

    const saveDatasetResult = await saveEquipmentDataset(projectId, { material, fittings })
    if (saveDatasetResult) return saveDatasetResult

    const fittingsByEngineId = new Map(fittings.items.map((i) => [i.nodeId, i.types]))
    const wellByEngineId = new Map(fittings.wells.map((w) => [w.nodeId, w.label]))
    const nodeUpdates = nodes.flatMap((row) => {
      const engineId = row.label ?? row.id
      const types = fittingsByEngineId.get(engineId)
      const well = wellByEngineId.get(engineId)
      if (!types && !well && !row.meta?.fittings) return []
      return [
        {
          id: row.id,
          project_id: projectId,
          kind: row.kind,
          label: row.label,
          x: row.x,
          y: row.y,
          ground_elevation: row.ground_elevation,
          building_id: row.building_id,
          meta: { ...row.meta, fittings: types ?? [], wellLabel: well ?? null },
        },
      ]
    })
    if (nodeUpdates.length > 0) {
      const upsert = await supabase.from('nodes').upsert(nodeUpdates)
      if (upsert.error) throw upsert.error
    }

    const label = `${MATERIAL_LABELS[material.primary] ?? material.primary} PN${material.pnBar}`
    const pipesUpdate = await supabase.from('pipes').update({ material: label }).eq('project_id', projectId)
    if (pipesUpdate.error) throw pipesUpdate.error

    return { ok: true }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    return { ok: false, reason: code === '23514' ? 'migrationNeeded' : 'error' }
  }
}

async function saveEquipmentDataset(
  projectId: string,
  content: unknown,
): Promise<EquipmentPersistResult | null> {
  const { data: existing, error: selectError } = await supabase
    .from('datasets')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', 'equipment')
    .maybeSingle()
  if (selectError) return { ok: false, reason: selectError.code === '23514' ? 'migrationNeeded' : 'error' }
  const write = existing
    ? await supabase.from('datasets').update({ content }).eq('id', existing.id)
    : await supabase.from('datasets').insert({ project_id: projectId, kind: 'equipment', content })
  if (write.error) return { ok: false, reason: write.error.code === '23514' ? 'migrationNeeded' : 'error' }
  return null
}

export interface FullPipelineParams {
  projectId: string
  buildings: Array<{ id: string; x: number; y: number; floors: number; residents: number }>
  source: { x: number; y: number; availableHead: number }
  surveyPoints: SurveyPoint[]
  norms: NormativeParams
  geology: GeologyInput
  seismicity: SeismicInput
  isoTimestamp: string
}

export type FullPipelineResult =
  | { ok: true; sizing: SizingResult }
  | { ok: false; reason: 'migrationNeeded' | 'error' }

/**
 * Runs the whole engineering pipeline end to end: routing, hydraulic sizing,
 * then materials and fittings, persisting each stage. Re-fetches the network
 * rows between stages so later stages merge onto (not overwrite) earlier
 * results.
 */
export async function runFullPipeline(params: FullPipelineParams): Promise<FullPipelineResult> {
  try {
    const network = traceNetwork(
      params.buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
      { x: params.source.x, y: params.source.y },
      params.surveyPoints,
    )
    await replaceNetwork(params.projectId, network)

    const afterTrace = await fetchNetworkRows(params.projectId)
    const availableHeadM = params.source.availableHead
    const sizing = await runSizingInWorker({
      network: networkFromRows(afterTrace.nodes, afterTrace.pipes),
      buildings: params.buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
      availableHeadM,
      norms: params.norms,
    })
    await persistSizing(
      params.projectId,
      sizing,
      afterTrace.nodes,
      afterTrace.pipes,
      params.norms,
      availableHeadM,
      params.isoTimestamp,
    )

    const afterSizing = await fetchNetworkRows(params.projectId)
    const equipment = await persistEquipment(
      params.projectId,
      networkFromRows(afterSizing.nodes, afterSizing.pipes),
      afterSizing.nodes,
      params.geology,
      params.seismicity,
      sizing,
    )
    if (!equipment.ok) return equipment

    return { ok: true, sizing }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

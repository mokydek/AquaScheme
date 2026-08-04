import { buildDecisionLog, MATERIAL_LABELS, placeFittings, selectMaterials, traceNetwork } from '@aquascheme/engine'
import type {
  GeologyInput,
  NormativeParams,
  SeismicInput,
  SurveyPoint,
  TracedNetwork,
} from '@aquascheme/engine'
import type { SizingInput, SizingResult } from '@aquascheme/engine/sizing'
import { isSizingResultAcceptable } from '@aquascheme/engine/sizing'
import type { HydraulicsWorkerResponse } from '../workers/hydraulics.worker'
import { supabase } from './supabase'
import { formatAppError } from './errorFormatting'
import { networkFromRows, replaceNetwork } from './network'
import type { NodeRow, PipeRow } from './network'
import { loadActiveCatalogSizes } from './catalog'
import { isPressurePipelineSystem } from './pressurePipeline'
import type { ProjectSystemType } from './pressurePipeline'

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

  const runInsert = await supabase
    .from('calc_runs')
    .insert({
      project_id: projectId,
      status: isSizingResultAcceptable(result) ? 'done' : 'failed',
      params: { ...norms, availableHeadM },
      summary: result as unknown as Record<string, unknown>,
      finished_at: isoTimestamp,
    })
    .select('id')
    .single()
  if (runInsert.error) throw runInsert.error

  // Decision log: applied network rules and their norm basis (best effort so a
  // missing 0005 migration never blocks the calculation).
  try {
    const calcRunId = runInsert.data?.id as string | undefined
    const entries = buildDecisionLog(norms).map((e) => ({
      project_id: projectId,
      calc_run_id: calcRunId ?? null,
      key: e.key,
      value_text: e.valueText,
      norm_refs: e.refs,
      basis: e.basis,
    }))
    await supabase.from('decision_log').delete().eq('project_id', projectId)
    await supabase.from('decision_log').insert(entries)
  } catch {
    // Ignore: decision log is not critical to the calculation itself.
  }
}

export type EquipmentPersistResult =
  | { ok: true }
  /** `detail` — текст самой ошибки: без него пользователь видит только «ошибка». */
  | { ok: false; reason: 'migrationNeeded' | 'error'; detail?: string }

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
    return {
      ok: false,
      reason: code === '23514' ? 'migrationNeeded' : 'error',
      detail: formatAppError(error),
    }
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
  if (selectError) {
    return {
      ok: false,
      reason: selectError.code === '23514' ? 'migrationNeeded' : 'error',
      detail: formatAppError(selectError),
    }
  }
  const write = existing
    ? await supabase.from('datasets').update({ content }).eq('id', existing.id)
    : await supabase.from('datasets').insert({ project_id: projectId, kind: 'equipment', content })
  if (write.error) {
    return {
      ok: false,
      reason: write.error.code === '23514' ? 'migrationNeeded' : 'error',
      detail: formatAppError(write.error),
    }
  }
  return null
}

export interface FullPipelineParams {
  projectId: string
  systemType: ProjectSystemType
  buildings: Array<{
    id: string
    x: number
    y: number
    floors: number
    residents: number
    specificDemandLpd?: number
  }>
  source: { x: number; y: number; availableHead: number }
  surveyPoints: SurveyPoint[]
  norms: NormativeParams
  geology: GeologyInput
  seismicity: SeismicInput
  isoTimestamp: string
  activeCatalogId?: string | null
}

export type FullPipelineResult =
  | { ok: true; sizing: SizingResult }
  | {
      ok: false
      reason: 'migrationNeeded' | 'error' | 'hydraulicsFailed' | 'wrongSystem'
      /**
       * Текст ошибки для пользователя.
       *
       * Конвейер ловил исключение и отдавал голое `error`. Вместе с ним
       * пропадали единственные сообщения, по которым видно, что делать:
       * «требуется применить миграцию 0012», «некорректные связи узлов со
       * зданиями». Страница показывала «Ошибка» без единой подробности, хотя
       * место под неё в разметке было.
       */
      detail?: string
      sizing?: SizingResult
    }

/**
 * Runs the whole engineering pipeline end to end: routing, hydraulic sizing,
 * then materials and fittings, persisting each stage. Re-fetches the network
 * rows between stages so later stages merge onto (not overwrite) earlier
 * results.
 */
export async function runFullPipeline(params: FullPipelineParams): Promise<FullPipelineResult> {
  // This pipeline is exclusively for pressurised B1 networks. K1/K2 use the
  // Chezy-Manning gravity workflow and must never be sent to EPANET merely
  // because a React closure still contains an older project type.
  if (!isPressurePipelineSystem(params.systemType)) return { ok: false, reason: 'wrongSystem' }
  // Напор источника — исходное данное, а не умолчание расчёта. Прежде вызовы
  // подставляли 45 м, и весь подбор диаметров стоял на выдуманной величине.
  // Проверка идёт до трассировки: отказываться надо прежде, чем сеть записана.
  if (!Number.isFinite(params.source.availableHead) || !(params.source.availableHead > 0)) {
    return {
      ok: false,
      reason: 'error',
      detail: 'Не задан свободный напор на источнике: подбор диаметров без него не выполняется.',
    }
  }
  try {
    const network = traceNetwork(
      params.buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
      { x: params.source.x, y: params.source.y },
      params.surveyPoints,
    )
    await replaceNetwork(params.projectId, network)

    const afterTrace = await fetchNetworkRows(params.projectId)
    const availableHeadM = params.source.availableHead
    const catalog = await loadActiveCatalogSizes(params.activeCatalogId ?? null)
    const sizing = await runSizingInWorker({
      network: networkFromRows(afterTrace.nodes, afterTrace.pipes),
      buildings: params.buildings.map((b) => ({
        id: b.id,
        floors: b.floors,
        residents: b.residents,
        specificDemandLpd: b.specificDemandLpd,
      })),
      availableHeadM,
      norms: params.norms,
      ...(catalog ? { sizes: catalog.sizes, roughnessMm: catalog.roughnessMm } : {}),
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
    if (!isSizingResultAcceptable(sizing)) {
      return { ok: false, reason: 'hydraulicsFailed', sizing }
    }

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
  } catch (error) {
    return { ok: false, reason: 'error', detail: formatAppError(error) }
  }
}

import { estimateRoughnessMm, importNetwork } from '@aquascheme/engine'

import type { ExistingMaterial, ImportSegment, PipeDecision, SurveyPoint } from '@aquascheme/engine'
import { supabase } from './supabase'

export interface ExistingPipeMeta {
  ax: number
  ay: number
  bx: number
  by: number
  overgrowthPercent?: number
  defects?: string
  /**
   * Откуда взята шероховатость, введённая рукой.
   *
   * Обязателен: у материала без кривой износа величину принимает инженер, а
   * принятая без источника величина неотличима от выдуманной.
   */
  roughnessSource?: string
}

export interface ExistingPipeRow {
  id: string
  project_id: string
  length_m: number | null
  diameter_mm: number | null
  material: string | null
  laid_year: number | null
  wear_percent: number | null
  roughness_mm: number | null
  decision: PipeDecision
  meta: ExistingPipeMeta | null
}

export async function fetchExisting(projectId: string): Promise<ExistingPipeRow[]> {
  const { data, error } = await supabase
    .from('existing_pipes')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ExistingPipeRow[]
}

/**
 * Import an existing network from route segments: stitch endpoints (reusing
 * the tested importer), then store each main as an isolated existing pipe
 * with its endpoint coordinates in meta.
 */
export async function replaceExisting(
  projectId: string,
  segments: ImportSegment[],
  surveyPoints: SurveyPoint[],
): Promise<number> {
  const first = segments[0]?.points[0] ?? { x: 0, y: 0 }
  const { network } = importNetwork(segments, [], first, surveyPoints)
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

  const rows = network.pipes
    .filter((p) => p.kind === 'main')
    .flatMap((p) => {
      const a = nodeById.get(p.fromNode)
      const b = nodeById.get(p.toNode)
      if (!a || !b) return []
      return [
        {
          project_id: projectId,
          length_m: p.lengthM,
          // Импорт линий чертежа о трубе не знает НИЧЕГО: ни материала, ни
          // износа. Здесь стояли «сталь, износ 50 %» и посчитанная по ним
          // шероховатость — три выдуманные величины на каждый участок, и на
          // Станкевича они были бы прямо неверны: труба керамическая. Пустая
          // графа честнее: материал и износ заполняет инженер по акту.
          material: null,
          wear_percent: null,
          roughness_mm: null,
          decision: 'keep' as PipeDecision,
          meta: { ax: a.x, ay: a.y, bx: b.x, by: b.y },
        },
      ]
    })

  const del = await supabase.from('existing_pipes').delete().eq('project_id', projectId)
  if (del.error) throw del.error
  if (rows.length === 0) return 0
  const ins = await supabase.from('existing_pipes').insert(rows)
  if (ins.error) throw ins.error
  return rows.length
}

export interface ExistingPipePatch {
  material?: ExistingMaterial
  laid_year?: number | null
  diameter_mm?: number | null
  wear_percent?: number | null
  decision?: PipeDecision
  overgrowthPercent?: number | null
  defects?: string
  /** Шероховатость, принятая инженером: только вместе с источником. */
  roughness_mm?: number | null
  roughnessSource?: string
}

/**
 * Обновляет участок существующей сети и пересчитывает шероховатость.
 *
 * У материала без кривой износа — керамика — расчётной величины НЕТ, и
 * подставить её нечем: величину принимает инженер и обязан назвать источник.
 * Значение без источника не сохраняется вовсе: принятая без источника величина
 * в проекте неотличима от выдуманной.
 */
export async function updateExistingPipe(
  row: ExistingPipeRow,
  patch: ExistingPipePatch,
): Promise<void> {
  const material = (patch.material ?? (row.material as ExistingMaterial) ?? 'unknown') as ExistingMaterial
  const wear = patch.wear_percent ?? row.wear_percent ?? 0
  const overgrowth = patch.overgrowthPercent ?? row.meta?.overgrowthPercent ?? 0
  const estimated = estimateRoughnessMm(material, wear, overgrowth)

  const bySource = patch.roughness_mm != null
  if (bySource && !patch.roughnessSource?.trim()) {
    throw new Error('Шероховатость принимается только с источником: величина без него неотличима от выдуманной.')
  }
  // Расчёт по кривой износа главнее ручного ввода там, где кривая есть: иначе
  // однажды введённое значение пережило бы смену материала и износа. Там, где
  // кривой нет, остаётся принятое инженером — и только оно.
  const roughness = estimated ?? (bySource ? patch.roughness_mm ?? null : row.meta?.roughnessSource ? row.roughness_mm : null)

  const meta: ExistingPipeMeta = {
    ax: row.meta?.ax ?? 0,
    ay: row.meta?.ay ?? 0,
    bx: row.meta?.bx ?? 0,
    by: row.meta?.by ?? 0,
    overgrowthPercent: overgrowth,
    defects: patch.defects ?? row.meta?.defects,
    // Источник сохраняется только при принятой руками величине; там, где
    // считает кривая, он не нужен и не должен оставаться от прошлого материала.
    ...(estimated == null
      ? { roughnessSource: bySource ? patch.roughnessSource?.trim() : row.meta?.roughnessSource }
      : {}),
  }
  const { error } = await supabase
    .from('existing_pipes')
    .update({
      material,
      laid_year: patch.laid_year ?? row.laid_year,
      diameter_mm: patch.diameter_mm ?? row.diameter_mm,
      wear_percent: wear,
      decision: patch.decision ?? row.decision,
      roughness_mm: roughness,
      meta,
    })
    .eq('id', row.id)
  if (error) throw error
}

export async function deleteExistingAll(projectId: string): Promise<void> {
  await supabase.from('existing_pipes').delete().eq('project_id', projectId)
}

import { supabase } from './supabase'

export type DatasetKind =
  | 'topography'
  | 'buildings'
  | 'source'
  | 'geology'
  | 'seismic'
  | 'normative'
  | 'equipment'
  | 'region'
  | 'drainage'
  | 'basis'
  | 'route_constraints'
  | 'route_audit'
  | 'manhole_catalog'
  // Каталог насосов на трассу не влияет, поэтому его изменение, в отличие от
  // каталога колодцев, не переводит расчёт трассы в 'stale'.
  | 'pump_catalog'
  /** Организация и подписанты основной надписи; на трассу не влияет. */
  | 'title_block'
  /** Диаметры по схеме генплана: основа, от которой считаются отклонения.
   * Трассу не меняет — сверяется уже посчитанный проект. */
  | 'master_plan'
  /**
   * Проектные отметки вертикальной планировки.
   *
   * Отдельно от 'topography': съёмка — измеренная поверхность, а это проектная,
   * и глубины заложения считаются от второй. Смешивать их в одном наборе
   * значило бы потерять, что измерено, а что назначено проектом.
   */
  | 'vertical_plan'
  /**
   * Подтверждённая разбивка на самотёчные бассейны.
   *
   * Решение инженера, а не расчёт: программа предлагает разбивку, но где
   * ставить перекачку — вопрос компоновки и согласований.
   */
  | 'gravity_basins'
  /**
   * Контрактные величины проекта: проектный диаметр, требуемый просвет,
   * ширина проезжей части. Одно место на весь проект — до этого диаметр
   * спрашивался двумя секциями независимо и расходился молча.
   */
  | 'technical_conditions'

export interface DatasetRow {
  id: string
  project_id: string
  kind: DatasetKind
  file_name: string | null
  content: unknown
  meta: unknown
  created_at: string
}

export interface BuildingRow {
  id: string
  label: string | null
  x: number
  y: number
  floors: number
  residents: number | null
  specific_demand_lpd?: number | null
  /** Explicit engineering inflow. Never store L/s in a consumption-per-day field. */
  design_flow_lps?: number | null
}

/** The 'source' dataset content (water source or sewer outlet point). */
export interface SourceData {
  x: number
  y: number
  groundElevation?: number
  availableHead?: number
}

async function updateDatasetRows(
  projectId: string,
  kind: DatasetKind,
  values: { content: unknown; meta: unknown; file_name: string | null },
): Promise<number> {
  // Updating every matching row also makes legacy duplicates consistent until
  // migration 0014 deterministically keeps one canonical row.
  const { data, error } = await supabase
    .from('datasets')
    .update(values)
    .eq('project_id', projectId)
    .eq('kind', kind)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

/** Insert or update the single dataset row of the given kind for a project. */
/**
 * Содержимое набора, каким оно лежит в базе СЕЙЧАС.
 *
 * Нужен запасному пути сохранения basis-файлов: он обязан сливать своё с уже
 * записанным, а не писать поверх снимка, взятого в браузере. Снимок устаревает
 * от каждой предыдущей записи, и шесть загрузок подряд оставляли один файл.
 */
export async function loadDatasetContent(projectId: string, kind: DatasetKind): Promise<unknown> {
  const { data, error } = await supabase
    .from('datasets')
    .select('content')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .order('created_at', { ascending: true })
  if (error) throw error
  // Установки без миграции 0014 могут держать несколько строк одного вида:
  // берётся объединение, чтобы чтение не теряло то, чего не видит запись.
  //
  // Два ключа объединяются вглубь: в них по одной записи на документ, и
  // поверхностная замена целого объекта потеряла бы соседние документы —
  // ровно так набор basis и терял файлы. Остальные ключи заменяются целиком.
  const DEEP: readonly string[] = ['files', 'extracted']
  const merged: Record<string, unknown> = {}
  for (const row of data ?? []) {
    const content = row.content
    if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
      const deep = new Map(DEEP.map((key) => [key, { ...(merged[key] as Record<string, unknown> ?? {}) }]))
      Object.assign(merged, content)
      for (const key of DEEP) {
        const rowValue = (content as Record<string, unknown>)[key]
        const accumulated = deep.get(key) ?? {}
        if (typeof rowValue === 'object' && rowValue !== null) Object.assign(accumulated, rowValue)
        if (Object.keys(accumulated).length > 0) merged[key] = accumulated
      }
    }
  }
  return merged
}

export async function saveDataset(
  projectId: string,
  kind: DatasetKind,
  content: unknown,
  meta: unknown = null,
  fileName: string | null = null,
): Promise<void> {
  const values = { content, meta, file_name: fileName }
  const updated = await updateDatasetRows(projectId, kind, values)
  if (updated === 0) {
    const { error: insertError } = await supabase
      .from('datasets')
      .insert({ project_id: projectId, kind, ...values })
    if (insertError) {
      // With migration 0014, two concurrent creators cannot leave duplicates.
      // The request that loses the insert race updates the winner instead.
      if (insertError.code !== '23505') throw insertError
      const retryUpdated = await updateDatasetRows(projectId, kind, values)
      if (retryUpdated === 0) throw insertError
    }
  }

  if (['topography', 'buildings', 'source', 'geology', 'basis', 'route_constraints', 'route_audit', 'manhole_catalog'].includes(kind)) {
    // Best effort for installations that have not applied migration 0012 yet.
    await supabase.from('projects').update({ route_status: 'stale' }).eq('id', projectId)
  }
}

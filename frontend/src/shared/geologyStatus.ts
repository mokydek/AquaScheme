import type { DatasetRow } from './datasets'

export interface FreezingDepthStatus {
  available: boolean
  verified: boolean
  /** Величина взята из учебного набора: к выпуску не допускается. */
  synthetic: boolean
  valueM: number | null
  source?: string
  detail: string
  blockers: string[]
}

interface GeologyFreezingContent {
  freezingDepthM?: unknown
  freezingDepthSource?: unknown
  freezingDepthVerified?: unknown
  sourceFile?: unknown
  synthetic?: unknown
}

/**
 * A numeric value alone is not sufficient for a final engineering issue.
 * The source and the explicit verification decision are persisted separately,
 * so an old/default/demo value cannot silently become an approved input.
 */
export function freezingDepthStatus(dataset?: DatasetRow): FreezingDepthStatus {
  const content = (dataset?.content ?? {}) as GeologyFreezingContent
  const rawValue = typeof content.freezingDepthM === 'number' ? content.freezingDepthM : Number.NaN
  const valueM = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : null
  const explicitSource = typeof content.freezingDepthSource === 'string'
    ? content.freezingDepthSource.trim()
    : ''
  const reportSource = typeof content.sourceFile === 'string' ? content.sourceFile.trim() : ''
  const rowSource = dataset?.file_name?.trim() ?? ''
  const source = explicitSource || reportSource || rowSource || undefined
  const blockers: string[] = []

  if (valueM === null) blockers.push('Не задана положительная расчётная глубина промерзания.')
  if (!source) blockers.push('Не указан источник глубины промерзания.')
  if (content.freezingDepthVerified !== true) {
    blockers.push('Глубина промерзания не подтверждена ответственным инженером.')
  }
  const synthetic = content.synthetic === true
  if (synthetic) blockers.push('Синтетические демонстрационные данные не допускаются к финальному выпуску.')

  /**
   * ПОДТВЕРЖДЁННОСТЬ И СИНТЕТИЧНОСТЬ — РАЗНЫЕ ВЕЩИ.
   *
   * Здесь синтетика обнуляла подтверждение, и демо получало стоп-фактор
   * «глубина промерзания не подтверждена» — при том что в демо-наборе она
   * задана, подписана источником и подтверждена. Программа врала о причине:
   * настоящая причина не в промерзании, а в том, что данные учебные.
   *
   * Теперь величина подтверждена, если подтверждена, а синтетичность едет
   * отдельным признаком и запрещает ровно то, что должна, — выпуск.
   */
  const verified = valueM !== null
    && Boolean(source)
    && content.freezingDepthVerified === true

  return {
    available: valueM !== null,
    verified,
    synthetic,
    valueM,
    source,
    detail: valueM === null
      ? 'значение отсутствует'
      : `${valueM.toFixed(2)} м${source ? `; источник: ${source}` : ''}`,
    blockers,
  }
}

import type { DatasetRow } from './datasets'

export interface FreezingDepthStatus {
  available: boolean
  verified: boolean
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
  if (content.synthetic === true) blockers.push('Синтетические демонстрационные данные не допускаются к финальному выпуску.')

  const verified = valueM !== null
    && Boolean(source)
    && content.freezingDepthVerified === true
    && content.synthetic !== true

  return {
    available: valueM !== null,
    verified,
    valueM,
    source,
    detail: valueM === null
      ? 'значение отсутствует'
      : `${valueM.toFixed(2)} м${source ? `; источник: ${source}` : ''}`,
    blockers,
  }
}

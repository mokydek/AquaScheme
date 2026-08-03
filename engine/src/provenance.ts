import type { Justified } from './normregistry'

/**
 * Откуда взялось значение.
 *
 * В проекте уже были `dataSource`, `sourceLayer`, `file_name`, хеши файлов и
 * `Justified` для нормативных величин — но каждый из них отвечал за свой
 * кусок, и общего ответа на вопрос «это измерено или принято?» не было. На
 * экспертизе спрашивают именно его, и разница между отметкой, снятой
 * геодезистом, и тем же числом, подставленным по умолчанию, решает судьбу
 * листа.
 *
 * Разряды намеренно немногочисленны и упорядочены по убыванию доверия:
 * измерено > выведено > каталог > норма > принято > отсутствует.
 */

export type ProvenanceKind =
  /** Прямо из исходного файла: отметка точки съёмки, лоток колодца. */
  | 'measured'
  /** Вычислено из измеренного: уклон между двумя лотками, пикетаж. */
  | 'derived'
  /** Из каталога проекта: код АГСК, марка насоса, тип колодца. */
  | 'catalogue'
  /**
   * Заявлено заданием на проектирование или техническими условиями: проектный
   * диаметр, требуемый просвет в пересечении, состав комплекта.
   *
   * Отдельный разряд, потому что это авторитетный вход проекта, а не догадка:
   * «принято по умолчанию» такие величины описывает неверно и делает
   * непригодным к выпуску то, что на самом деле подтверждено документом.
   * Подтверждается ссылкой на документ и подписью ответственного.
   */
  | 'stated'
  /** Из норматива с подтверждённым пунктом. */
  | 'normative'
  /** Принято по умолчанию или инженерным решением; требует подтверждения. */
  | 'assumed'
  /** Значения нет. */
  | 'absent'

export interface Provenance {
  kind: ProvenanceKind
  /** Чем именно подтверждается: файл и слой, документ и пункт, каталог. */
  source: string
  /** Для `derived` — на чём основано. */
  derivedFrom?: string[]
  /**
   * Подтверждено ответственным лицом либо источником, пригодным для выпуска.
   * `assumed` и `absent` подтверждёнными не бывают.
   */
  verified: boolean
  note?: string
}

export interface Traced<T> {
  value: T
  provenance: Provenance
}

// Порядок по убыванию доверия. Взаимное расположение прежних разрядов не
// менялось: `stated` встал между каталогом и нормативом, потому что задание
// конкретнее общей нормы, но и не является измерением.
const RANK: Record<ProvenanceKind, number> = {
  measured: 6, derived: 5, catalogue: 4, stated: 3, normative: 2, assumed: 1, absent: 0,
}

const LABEL: Record<ProvenanceKind, string> = {
  measured: 'измерено',
  derived: 'выведено из измеренного',
  catalogue: 'каталог проекта',
  stated: 'заявлено заданием или ТУ',
  normative: 'норматив',
  assumed: 'принято по умолчанию',
  absent: 'отсутствует',
}

export const provenanceLabel = (kind: ProvenanceKind): string => LABEL[kind]

export function traced<T>(value: T, provenance: Provenance): Traced<T> {
  // Принятое и отсутствующее не может быть подтверждённым: подтверждение
  // означает пригодность к выпуску, а такие значения к нему не пригодны.
  const verified = provenance.kind === 'assumed' || provenance.kind === 'absent'
    ? false
    : provenance.verified
  return { value, provenance: { ...provenance, verified } }
}

export const measured = <T>(value: T, source: string, note?: string): Traced<T> =>
  traced(value, { kind: 'measured', source, verified: true, ...(note ? { note } : {}) })

export const derived = <T>(value: T, source: string, derivedFrom: string[], note?: string): Traced<T> =>
  traced(value, { kind: 'derived', source, derivedFrom, verified: true, ...(note ? { note } : {}) })

export const fromCatalogue = <T>(value: T, source: string): Traced<T> =>
  traced(value, { kind: 'catalogue', source, verified: true })

export const assumed = <T>(value: T, source: string, note?: string): Traced<T> =>
  traced(value, { kind: 'assumed', source, verified: false, ...(note ? { note } : {}) })

export const absent = <T>(source: string): Traced<T | null> =>
  traced<T | null>(null, { kind: 'absent', source, verified: false })

/**
 * Переносит нормативную величину в общую модель. `Justified` уже несёт ссылки
 * на пункты реестра; подтверждённой она считается, только когда основание
 * нормативное — инженерное или экономическое решение остаётся принятым.
 */
export function fromJustified<T>(value: Justified<T>, source?: string): Traced<T> {
  const refs = value.refs.join(', ')
  if (value.basis === 'normative') {
    return traced(value.value, {
      kind: 'normative',
      source: source ?? refs,
      verified: true,
      ...(value.note ? { note: value.note } : {}),
    })
  }
  return traced(value.value, {
    kind: 'assumed',
    source: source ?? refs,
    verified: false,
    note: value.note ?? `основание: ${value.basis}`,
  })
}

/** Наименее достоверное из происхождений — то, чем ограничен результат. */
export function weakest(items: Provenance[]): Provenance | null {
  if (items.length === 0) return null
  return items.reduce((worst, item) => (RANK[item.kind] < RANK[worst.kind] ? item : worst))
}

export interface ProvenanceAudit {
  total: number
  byKind: Record<ProvenanceKind, number>
  /** Доля значений, пригодных к выпуску, 0…1. */
  verifiedShare: number
  /** Значения, которые не дают выпустить лист. */
  blockers: Array<{ field: string; kind: ProvenanceKind; source: string }>
}

/**
 * Сводка по набору значений. Принятое и отсутствующее перечисляются поимённо:
 * лист с ними выпускать нельзя, и инженер должен видеть, что именно закрыть.
 */
export function auditProvenance(fields: Record<string, Traced<unknown>>): ProvenanceAudit {
  const byKind: Record<ProvenanceKind, number> = {
    measured: 0, derived: 0, catalogue: 0, stated: 0, normative: 0, assumed: 0, absent: 0,
  }
  const blockers: ProvenanceAudit['blockers'] = []
  const entries = Object.entries(fields)
  for (const [field, item] of entries) {
    byKind[item.provenance.kind] += 1
    if (!item.provenance.verified) {
      blockers.push({ field, kind: item.provenance.kind, source: item.provenance.source })
    }
  }
  const verified = entries.filter(([, item]) => item.provenance.verified).length
  return {
    total: entries.length,
    byKind,
    verifiedShare: entries.length === 0 ? 0 : Number((verified / entries.length).toFixed(4)),
    blockers,
  }
}

import { NORM_REGISTRY, NORM_DOCUMENTS, type NormClause, type NormDocument } from './normregistry'

/**
 * Какой документ главнее, когда два говорят об одном.
 *
 * Правило проекта (docs/norms/INDEX.md): Кодексы РК > СН РК > СП РК > ГОСТ,
 * российский ГОСТ Р — только методический образец; при расхождении изданий
 * действует более позднее, пока пользователь не решил иначе. До сих пор это
 * правило существовало текстом в документации, и ничто не мешало движку
 * сослаться на раннее издание или на российский стандарт там, где есть
 * казахстанский.
 *
 * Модуль ничего не выбирает молча: `resolveConflict` возвращает и победителя,
 * и вытесненные записи с причиной, чтобы решение было видно в журнале.
 */

export type DocumentTier = 'code' | 'sn' | 'sp' | 'gost' | 'gost_r' | 'other'

/** Порядок применения; больше — главнее. */
const TIER_RANK: Record<DocumentTier, number> = {
  code: 5, sn: 4, sp: 3, gost: 2, gost_r: 1, other: 0,
}

const TIER_LABEL: Record<DocumentTier, string> = {
  code: 'Кодекс РК',
  sn: 'СН РК',
  sp: 'СП РК',
  gost: 'ГОСТ',
  gost_r: 'ГОСТ Р (методический образец)',
  other: 'прочий документ',
}

/** Разряд документа по его коду. */
export function documentTier(code: string): DocumentTier {
  const value = code.trim()
  // `\b` в JS опирается на [A-Za-z0-9_], поэтому после кириллицы границы слова
  // нет — конец фрагмента задаётся явно пробелом или концом строки.
  const end = '(?:\\s|$)'
  const starts = (prefix: string) => new RegExp(`^${prefix}${end}`, 'i').test(value)
  if (/кодекс/i.test(value)) return 'code'
  // «ГОСТ Р» проверяется до «ГОСТ»: это российский стандарт, а не межгосударственный.
  if (starts('ГОСТ\\s+Р')) return 'gost_r'
  if (starts('ГОСТ')) return 'gost'
  if (starts('СН\\s*РК')) return 'sn'
  if (starts('СП\\s*РК')) return 'sp'
  return 'other'
}

/**
 * Год издания из кода документа. Берётся последняя четырёхзначная группа:
 * в «СН РК 4.01-03-2013*» номер документа тоже содержит цифры.
 */
export function editionYear(code: string): number | null {
  const years = code.match(/\b(19|20)\d{2}\b/g)
  if (!years || years.length === 0) return null
  return Number(years[years.length - 1])
}

/**
 * Семейство документа — код без года и звёздочки. Два издания одного норматива
 * дают одно семейство, поэтому их можно сравнивать по году.
 */
export function documentFamily(code: string): string {
  return code.replace(/\b(19|20)\d{2}\b/g, '').replace(/\*/g, '').replace(/[-\s]+$/g, '').trim()
}

export interface ConflictResolution {
  governing: NormDocument
  superseded: Array<{ document: NormDocument; reason: string }>
}

/**
 * Выбирает главенствующий документ из нескольких. Сначала сравниваются
 * разряды, затем — год издания внутри одного семейства.
 */
export function resolveConflict(documents: NormDocument[]): ConflictResolution | null {
  if (documents.length === 0) return null
  const ranked = [...documents].sort((left, right) => {
    const tier = TIER_RANK[documentTier(right.code)] - TIER_RANK[documentTier(left.code)]
    if (tier !== 0) return tier
    return (editionYear(right.code) ?? 0) - (editionYear(left.code) ?? 0)
  })
  const governing = ranked[0]
  const superseded = ranked.slice(1).map((document) => {
    const sameFamily = documentFamily(document.code) === documentFamily(governing.code)
    const tierGap = TIER_RANK[documentTier(governing.code)] - TIER_RANK[documentTier(document.code)]
    if (sameFamily && tierGap === 0) {
      return {
        document,
        reason: `Раннее издание: действует ${governing.code} (${editionYear(governing.code) ?? '—'}) `
          + `вместо ${document.code} (${editionYear(document.code) ?? '—'}).`,
      }
    }
    return {
      document,
      reason: `Ниже по иерархии: ${TIER_LABEL[documentTier(governing.code)]} важнее, `
        + `чем ${TIER_LABEL[documentTier(document.code)]}.`,
    }
  })
  return { governing, superseded }
}

export interface HierarchyIssue {
  code: 'SUPERSEDED_EDITION' | 'METHODOLOGICAL_ONLY' | 'UNKNOWN_DOCUMENT'
  clauseId: string
  documentCode: string
  message: string
}

/**
 * Проверяет, что ни одно правило реестра не опирается на вытесненный документ.
 * Это и есть автоматическая иерархия: раньше выбор издания держался на
 * внимательности того, кто добавлял запись.
 */
export function auditClauseHierarchy(
  clauses: NormClause[] = NORM_REGISTRY,
  documents: NormDocument[] = NORM_DOCUMENTS,
): HierarchyIssue[] {
  const byCode = new Map(documents.map((document) => [document.code, document]))

  // Внутри семейства действует позднейшее издание.
  const latestByFamily = new Map<string, NormDocument>()
  for (const document of documents) {
    const family = documentFamily(document.code)
    const current = latestByFamily.get(family)
    if (!current || (editionYear(document.code) ?? 0) > (editionYear(current.code) ?? 0)) {
      latestByFamily.set(family, document)
    }
  }

  const issues: HierarchyIssue[] = []
  for (const clause of clauses) {
    const document = byCode.get(clause.documentCode)
    if (!document) {
      issues.push({
        code: 'UNKNOWN_DOCUMENT',
        clauseId: clause.id,
        documentCode: clause.documentCode,
        message: `Правило ссылается на документ «${clause.documentCode}», которого нет в реестре.`,
      })
      continue
    }
    const latest = latestByFamily.get(documentFamily(document.code))
    if (latest && latest.code !== document.code) {
      issues.push({
        code: 'SUPERSEDED_EDITION',
        clauseId: clause.id,
        documentCode: document.code,
        message: `Правило опирается на раннее издание «${document.code}»; действует «${latest.code}».`,
      })
    }
    if (documentTier(document.code) === 'gost_r' && clause.status === 'verified') {
      issues.push({
        code: 'METHODOLOGICAL_ONLY',
        clauseId: clause.id,
        documentCode: document.code,
        message: `«${document.code}» — российский стандарт, используется как методический образец; `
          + 'правило не может считаться подтверждённым нормой РК.',
      })
    }
  }
  return issues
}

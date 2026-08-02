import { NORM_DOCUMENTS, NORM_REGISTRY, type NormClause, type NormDocument } from './normregistry'

/**
 * Слепок нормативной базы на дату расчёта.
 *
 * Проект считается по редакциям, действовавшим в конкретный день, и защищается
 * этим же составом на экспертизе. Норматив может смениться, у правила может
 * появиться подтверждённый пункт вместо «неизвестно» — и тогда расчёт
 * полугодовой давности молча перестаёт соответствовать тому, на что ссылается
 * пояснительная записка. До сих пор ничто такое расхождение не показывало.
 *
 * `createNormLock` снимает состав документов и статусы правил, а
 * `verifyNormLock` сравнивает его с текущим и перечисляет расхождения. Замок
 * ничего не блокирует сам: он сообщает, что изменилось, — решение о
 * пересчёте принимает инженер.
 */

export interface NormLockDocument {
  code: string
  edition: string
  status: NormClause['status']
}

export interface NormLock {
  /** Дата, на которую зафиксирована база, ISO. */
  lockedAtIso: string
  documents: NormLockDocument[]
  /** Статусы правил: id -> статус и пункт на момент фиксации. */
  clauses: Array<{ id: string; documentCode: string; clause: string | null; status: NormClause['status'] }>
}

export type NormDriftKind =
  | 'document_edition_changed'
  | 'document_added'
  | 'document_removed'
  | 'clause_status_changed'
  | 'clause_reference_changed'
  | 'clause_added'
  | 'clause_removed'

export interface NormDrift {
  kind: NormDriftKind
  /** Код документа или id правила. */
  subject: string
  was: string | null
  now: string | null
  message: string
  /**
   * Расхождение затрагивает основание принятых решений, а не только состав
   * реестра: пересчёт нужен до выпуска.
   */
  affectsDesign: boolean
}

export interface NormLockVerdict {
  ok: boolean
  lockedAtIso: string
  drift: NormDrift[]
  /** Сколько расхождений требуют пересчёта. */
  designAffectingCount: number
  reason: string
}

/** Снимает текущее состояние нормативной базы. */
export function createNormLock(
  lockedAtIso: string,
  documents: NormDocument[] = NORM_DOCUMENTS,
  clauses: NormClause[] = NORM_REGISTRY,
): NormLock {
  return {
    lockedAtIso,
    documents: documents
      .map((document) => ({ code: document.code, edition: document.edition, status: document.status }))
      .sort((left, right) => left.code.localeCompare(right.code)),
    clauses: clauses
      .map((clause) => ({
        id: clause.id,
        documentCode: clause.documentCode,
        clause: clause.clause,
        status: clause.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

/**
 * Сравнивает замок с текущей базой. Изменение подтверждённого правила или
 * редакции документа помечается как влияющее на проект; появление нового
 * правила — нет, оно не отменяет уже принятых решений.
 */
export function verifyNormLock(
  lock: NormLock,
  documents: NormDocument[] = NORM_DOCUMENTS,
  clauses: NormClause[] = NORM_REGISTRY,
): NormLockVerdict {
  const drift: NormDrift[] = []

  const currentDocuments = new Map(documents.map((document) => [document.code, document]))
  const lockedDocuments = new Map(lock.documents.map((document) => [document.code, document]))

  for (const [code, locked] of lockedDocuments) {
    const current = currentDocuments.get(code)
    if (!current) {
      drift.push({
        kind: 'document_removed', subject: code, was: locked.edition, now: null,
        message: `Документ «${code}» больше не в реестре, а проект на него ссылается.`,
        affectsDesign: true,
      })
      continue
    }
    if (current.edition !== locked.edition) {
      drift.push({
        kind: 'document_edition_changed', subject: code, was: locked.edition, now: current.edition,
        message: `Редакция «${code}» изменилась: было «${locked.edition}», стало «${current.edition}».`,
        affectsDesign: true,
      })
    }
  }
  for (const code of currentDocuments.keys()) {
    if (lockedDocuments.has(code)) continue
    drift.push({
      kind: 'document_added', subject: code, was: null,
      now: currentDocuments.get(code)?.edition ?? null,
      message: `В реестре появился документ «${code}», которого не было на дату расчёта.`,
      affectsDesign: false,
    })
  }

  const currentClauses = new Map(clauses.map((clause) => [clause.id, clause]))
  const lockedClauses = new Map(lock.clauses.map((clause) => [clause.id, clause]))

  for (const [id, locked] of lockedClauses) {
    const current = currentClauses.get(id)
    if (!current) {
      drift.push({
        kind: 'clause_removed', subject: id, was: locked.clause, now: null,
        message: `Правило «${id}» исчезло из реестра; решения проекта на него опирались.`,
        affectsDesign: true,
      })
      continue
    }
    if (current.status !== locked.status) {
      drift.push({
        kind: 'clause_status_changed', subject: id, was: locked.status, now: current.status,
        message: `Статус правила «${id}»: было «${locked.status}», стало «${current.status}».`,
        // Потеря подтверждения бьёт по проекту; обретение — повод перепроверить,
        // но принятые решения не отменяет.
        affectsDesign: locked.status === 'verified' && current.status !== 'verified',
      })
    }
    if ((current.clause ?? null) !== (locked.clause ?? null)) {
      drift.push({
        kind: 'clause_reference_changed', subject: id, was: locked.clause, now: current.clause ?? null,
        message: `Пункт правила «${id}»: было «${locked.clause ?? 'не указан'}», `
          + `стало «${current.clause ?? 'не указан'}».`,
        affectsDesign: locked.status === 'verified',
      })
    }
  }
  for (const id of currentClauses.keys()) {
    if (lockedClauses.has(id)) continue
    drift.push({
      kind: 'clause_added', subject: id, was: null, now: currentClauses.get(id)?.status ?? null,
      message: `В реестре появилось правило «${id}», которого не было на дату расчёта.`,
      affectsDesign: false,
    })
  }

  const designAffectingCount = drift.filter((item) => item.affectsDesign).length
  return {
    ok: designAffectingCount === 0,
    lockedAtIso: lock.lockedAtIso,
    drift,
    designAffectingCount,
    reason: drift.length === 0
      ? `Нормативная база не менялась с ${lock.lockedAtIso}.`
      : designAffectingCount === 0
        ? `С ${lock.lockedAtIso} база пополнилась (${drift.length}), но основания принятых решений не затронуты.`
        : `С ${lock.lockedAtIso} изменилось ${designAffectingCount} оснований из ${drift.length}: `
          + 'проект требует пересчёта до выпуска.',
  }
}

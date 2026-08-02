import { describe, expect, it } from 'vitest'
import type { NormClause, NormDocument } from './normregistry'
import { createNormLock, verifyNormLock } from './normlock'

const doc = (code: string, edition: string): NormDocument => ({
  code, title: code, edition, status: 'verified',
})
const clause = (
  id: string, documentCode: string, ref: string | null, status: NormClause['status'] = 'verified',
): NormClause => ({
  id, documentCode, clause: ref, requirement: '', valueText: '', units: '',
  appliesSystem: ['sewer'], appliesWork: ['new'], status,
})

const documents = [doc('СН РК 4.01-03-2013*', '2013 с изм.'), doc('ГОСТ 21.110-2013', '2013')]
const clauses = [clause('a', 'СН РК 4.01-03-2013*', '5.9.1'), clause('b', 'ГОСТ 21.110-2013', '4.1')]
const LOCKED = '2026-08-03'

describe('замок нормативных редакций', () => {
  it('на неизменившейся базе не находит расхождений', () => {
    const lock = createNormLock(LOCKED, documents, clauses)
    const verdict = verifyNormLock(lock, documents, clauses)
    expect(verdict.ok).toBe(true)
    expect(verdict.drift).toEqual([])
    expect(verdict.reason).toContain('не менялась')
  })

  it('ловит смену редакции документа', () => {
    const lock = createNormLock(LOCKED, documents, clauses)
    const verdict = verifyNormLock(
      lock, [doc('СН РК 4.01-03-2013*', '2013 с изм. 2027'), documents[1]], clauses,
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.drift[0].kind).toBe('document_edition_changed')
    expect(verdict.drift[0].affectsDesign).toBe(true)
    expect(verdict.reason).toContain('требует пересчёта')
  })

  it('потеря подтверждения бьёт по проекту, обретение — нет', () => {
    const lock = createNormLock(LOCKED, documents, clauses)

    const lost = verifyNormLock(lock, documents,
      [clause('a', 'СН РК 4.01-03-2013*', '5.9.1', 'unverified'), clauses[1]])
    expect(lost.designAffectingCount).toBe(1)

    const gainedLock = createNormLock(LOCKED, documents,
      [clause('a', 'СН РК 4.01-03-2013*', '5.9.1', 'unverified'), clauses[1]])
    const gained = verifyNormLock(gainedLock, documents, clauses)
    expect(gained.drift[0].kind).toBe('clause_status_changed')
    expect(gained.designAffectingCount).toBe(0)
    expect(gained.ok).toBe(true)
  })

  it('ловит смену номера пункта у подтверждённого правила', () => {
    const lock = createNormLock(LOCKED, documents, clauses)
    const verdict = verifyNormLock(lock, documents,
      [clause('a', 'СН РК 4.01-03-2013*', '5.9.2'), clauses[1]])
    expect(verdict.drift[0].kind).toBe('clause_reference_changed')
    expect(verdict.drift[0].was).toBe('5.9.1')
    expect(verdict.drift[0].now).toBe('5.9.2')
    expect(verdict.ok).toBe(false)
  })

  it('исчезнувшее правило или документ требуют пересчёта', () => {
    const lock = createNormLock(LOCKED, documents, clauses)
    const verdict = verifyNormLock(lock, [documents[0]], [clauses[0]])
    const kinds = verdict.drift.map((item) => item.kind)
    expect(kinds).toContain('document_removed')
    expect(kinds).toContain('clause_removed')
    expect(verdict.designAffectingCount).toBe(2)
  })

  it('пополнение базы не отменяет принятых решений', () => {
    const lock = createNormLock(LOCKED, documents, clauses)
    const verdict = verifyNormLock(
      lock,
      [...documents, doc('СП РК 4.01-103-2013', '2013')],
      [...clauses, clause('c', 'СП РК 4.01-103-2013', '1.1')],
    )
    expect(verdict.drift.map((item) => item.kind).sort())
      .toEqual(['clause_added', 'document_added'])
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toContain('пополнилась')
  })

  it('снимок не зависит от порядка записей в реестре', () => {
    const straight = createNormLock(LOCKED, documents, clauses)
    const shuffled = createNormLock(LOCKED, [...documents].reverse(), [...clauses].reverse())
    expect(shuffled).toEqual(straight)
  })

  it('снимается с действующего реестра и сходится сам с собой', () => {
    const lock = createNormLock(LOCKED)
    expect(lock.documents.length).toBeGreaterThan(10)
    expect(lock.clauses.length).toBeGreaterThan(50)
    expect(verifyNormLock(lock).ok).toBe(true)
  })
})

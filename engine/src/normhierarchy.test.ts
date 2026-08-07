import { describe, expect, it } from 'vitest'
import { getClause } from './normregistry'
import type { NormClause, NormDocument } from './normregistry'
import {
  auditClauseHierarchy,
  documentFamily,
  documentTier,
  editionYear,
  resolveConflict,
} from './normhierarchy'

const doc = (code: string): NormDocument => ({ code, title: code, edition: '', status: 'verified' })

describe('разряд документа', () => {
  it('различает кодекс, СН, СП и ГОСТ', () => {
    expect(documentTier('Водный кодекс Республики Казахстан')).toBe('code')
    expect(documentTier('СН РК 4.01-03-2013*')).toBe('sn')
    expect(documentTier('СП РК 4.01-103-2013')).toBe('sp')
    expect(documentTier('ГОСТ 21.110-2013')).toBe('gost')
  })

  it('отделяет российский ГОСТ Р от межгосударственного ГОСТ', () => {
    expect(documentTier('ГОСТ Р 21.101-2020')).toBe('gost_r')
    expect(documentTier('ГОСТ 21.704-2011')).toBe('gost')
  })
})

describe('издание и семейство', () => {
  it('берёт год из конца кода, а не из номера документа', () => {
    expect(editionYear('СН РК 4.01-03-2013*')).toBe(2013)
    expect(editionYear('СН РК 4.01-03-2011*')).toBe(2011)
    expect(editionYear('ГОСТ 21.110-2013')).toBe(2013)
  })

  it('сводит два издания одного норматива в одно семейство', () => {
    expect(documentFamily('СН РК 4.01-03-2013*')).toBe(documentFamily('СН РК 4.01-03-2011*'))
    expect(documentFamily('СН РК 4.01-03-2013*')).not.toBe(documentFamily('СП РК 4.01-103-2013'))
  })
})

describe('разрешение конфликта', () => {
  it('позднее издание вытесняет раннее', () => {
    const result = resolveConflict([doc('СН РК 4.01-03-2011*'), doc('СН РК 4.01-03-2013*')])
    expect(result?.governing.code).toBe('СН РК 4.01-03-2013*')
    expect(result?.superseded[0].reason).toContain('Раннее издание')
  })

  it('СН важнее СП, а кодекс важнее всех', () => {
    const result = resolveConflict([
      doc('ГОСТ 21.110-2013'), doc('СП РК 4.01-103-2013'),
      doc('СН РК 4.01-03-2013*'), doc('Водный кодекс Республики Казахстан'),
    ])
    expect(result?.governing.code).toBe('Водный кодекс Республики Казахстан')
    expect(result?.superseded.map((item) => item.document.code)).toEqual([
      'СН РК 4.01-03-2013*', 'СП РК 4.01-103-2013', 'ГОСТ 21.110-2013',
    ])
  })

  it('казахстанский ГОСТ идёт впереди российского', () => {
    const result = resolveConflict([doc('ГОСТ Р 21.101-2020'), doc('ГОСТ 21.704-2011')])
    expect(result?.governing.code).toBe('ГОСТ 21.704-2011')
    expect(result?.superseded[0].reason).toContain('методический образец')
  })

  it('на пустом списке возвращает null, а не выдумывает документ', () => {
    expect(resolveConflict([])).toBeNull()
  })
})

describe('аудит правил реестра', () => {
  const documents = [doc('СН РК 4.01-03-2013*'), doc('СН РК 4.01-03-2011*'), doc('ГОСТ Р 21.101-2020')]
  const clause = (id: string, documentCode: string, status: NormClause['status'] = 'verified'): NormClause => ({
    id, documentCode, clause: '1.1', requirement: '', valueText: '', units: '',
    appliesSystem: ['sewer'], appliesWork: ['new'], status,
  })

  it('ловит правило, опирающееся на вытесненное издание', () => {
    const issues = auditClauseHierarchy([clause('a', 'СН РК 4.01-03-2011*')], documents)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('SUPERSEDED_EDITION')
    expect(issues[0].message).toContain('действует «СН РК 4.01-03-2013*»')
  })

  it('не даёт считать подтверждённым правило по российскому образцу', () => {
    const issues = auditClauseHierarchy([clause('b', 'ГОСТ Р 21.101-2020')], documents)
    expect(issues.map((issue) => issue.code)).toContain('METHODOLOGICAL_ONLY')
  })

  it('молчит про неподтверждённое правило по образцу: оно и так не решение', () => {
    const issues = auditClauseHierarchy([clause('c', 'ГОСТ Р 21.101-2020', 'unverified')], documents)
    expect(issues.map((issue) => issue.code)).not.toContain('METHODOLOGICAL_ONLY')
  })

  it('ловит ссылку на документ вне реестра', () => {
    const issues = auditClauseHierarchy([clause('d', 'СНиП 2.04.02-84*')], documents)
    expect(issues[0].code).toBe('UNKNOWN_DOCUMENT')
  })

  it('действующий реестр не опирается на вытесненные издания', () => {
    const superseded = auditClauseHierarchy().filter((issue) => issue.code === 'SUPERSEDED_EDITION')
    expect(superseded.map((issue) => `${issue.clauseId}: ${issue.message}`)).toEqual([])
  })

  it('ни одно правило не ссылается на документ вне реестра', () => {
    const unknown = auditClauseHierarchy().filter((issue) => issue.code === 'UNKNOWN_DOCUMENT')
    expect(unknown.map((issue) => `${issue.clauseId} -> ${issue.documentCode}`)).toEqual([])
  })

  it('известен ровно один случай опоры на российский образец', () => {
    // `drawing.stamp` переписан по ГОСТ Р 21.101-2020, а тот зарегистрирован
    // как методический образец. Вопрос вынесен в docs/norms/CONFLICTS.md и
    // решается пользователем; тест фиксирует состояние, чтобы новый такой
    // случай не появился незаметно.
    //
    // Предупреждение относится только к ПОДТВЕРЖДЁННЫМ правилам: неподтверждённое
    // и так уходит инженеру на сверку, и второе сообщение о нём было бы шумом.
    // Пока в docs/norms нет ни одного PDF, подтверждённых правил нет вовсе, и
    // список пуст — это исход того же правила, а не его отказ. Единственный
    // ожидаемый случай остаётся зафиксированным по имени.
    const methodological = auditClauseHierarchy().filter((issue) => issue.code === 'METHODOLOGICAL_ONLY')
    const stampIsVerified = getClause('drawing.stamp')?.status === 'verified'
    expect(methodological.map((issue) => issue.clauseId)).toEqual(stampIsVerified ? ['drawing.stamp'] : [])
  })
})

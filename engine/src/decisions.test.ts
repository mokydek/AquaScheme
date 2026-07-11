import { describe, expect, it } from 'vitest'
import { buildDecisionLog, ISSUE_BASIS, ISSUE_REFS, REASON_REFS } from './decisions'
import { getClause } from './normregistry'
import { NORMATIVE_DEFAULTS } from './norms'

describe('decision to norm mapping', () => {
  it('maps every sizing issue to registry clauses or an explicit basis', () => {
    for (const kind of Object.keys(ISSUE_REFS) as Array<keyof typeof ISSUE_REFS>) {
      for (const id of ISSUE_REFS[kind]) {
        expect(getClause(id)).toBeDefined()
      }
      expect(ISSUE_BASIS[kind]).toBeDefined()
    }
    // A catalog limit is a project/economic decision, not a norm.
    expect(ISSUE_BASIS.noSuitableItem).toBe('economic')
    expect(ISSUE_REFS.lowPressure).toContain('freeHead.base')
  })

  it('marks material reasons with a basis, non normative ones explicitly', () => {
    expect(REASON_REFS.seismicJoints.basis).toBe('normative')
    expect(REASON_REFS.seismicJoints.refs).toContain('seismic.joints')
    expect(REASON_REFS.pressureClass.basis).toBe('economic')
    expect(REASON_REFS.corrosionProtection.basis).toBe('engineering')
    expect(REASON_REFS.corrosionProtection.note).toBeTruthy()
  })
})

describe('buildDecisionLog', () => {
  const log = buildDecisionLog(NORMATIVE_DEFAULTS)

  it('references only existing registry clauses', () => {
    for (const entry of log) {
      for (const id of entry.refs) expect(getClause(id)).toBeDefined()
    }
  })

  it('includes the key network rules and marks non normative ones', () => {
    const keys = log.map((e) => e.key)
    expect(keys).toContain('Свободный напор')
    expect(keys).toContain('Расход на пожаротушение')
    const material = log.find((e) => e.key === 'Материал труб')
    expect(material?.basis).toBe('economic')
    expect(material?.note).toContain('не регламентирует')
    const normativeEntries = log.filter((e) => e.basis === 'normative')
    expect(normativeEntries.every((e) => e.refs.length > 0)).toBe(true)
  })
})

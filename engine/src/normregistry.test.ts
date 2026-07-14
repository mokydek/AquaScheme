import { describe, expect, it } from 'vitest'
import {
  getClause,
  justified,
  NORM_DOCUMENTS,
  NORM_REGISTRY,
  unverifiedClauses,
} from './normregistry'

describe('norm registry', () => {
  it('every clause references a known document', () => {
    const codes = new Set(NORM_DOCUMENTS.map((d) => d.code))
    for (const clause of NORM_REGISTRY) {
      expect(codes.has(clause.documentCode)).toBe(true)
    }
  })

  it('an entry is verified only with a transcription source (file + PDF page)', () => {
    for (const clause of NORM_REGISTRY) {
      if (clause.status === 'verified') {
        expect(clause.sourceFile, clause.id).toMatch(/^docs\/norms\/.+\.pdf$/)
        expect(clause.sourcePage, clause.id).toBeGreaterThan(0)
        expect(clause.clause, clause.id).not.toBeNull()
      }
    }
    expect(unverifiedClauses().length).toBeLessThan(NORM_REGISTRY.length)
  })

  it('verified sewer clauses carry the values transcribed from СН РК 4.01-03-2013*', () => {
    expect(getClause('sewer.minDiameter')?.status).toBe('verified')
    expect(getClause('sewer.minDiameter')?.sourcePage).toBe(39)
    expect(getClause('sewer.slope.min')?.valueText).toContain('0.008')
    expect(getClause('drainage.equalsWater')?.status).toBe('verified')
    expect(getClause('drainage.equalsWater')?.clause).toBe('5.5.1')
  })

  it('clause ids are unique and resolvable', () => {
    const ids = NORM_REGISTRY.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getClause('freeHead.base')?.valueText).toBe('10')
    expect(getClause('nonexistent')).toBeUndefined()
  })

  it('a null clause marks TODO_NORM_REF (unknown exact number)', () => {
    expect(getClause('demand.perCapita')?.clause).toBeNull()
    expect(getClause('freeHead.base')?.clause).toBe('2.26')
  })

  it('justified() wraps a value with its basis', () => {
    const j = justified(10, ['freeHead.base'], 'normative')
    expect(j.value).toBe(10)
    expect(j.refs).toEqual(['freeHead.base'])
    expect(j.basis).toBe('normative')
    const eco = justified('ПЭ100', [], 'economic', 'норматив выбор не регламентирует')
    expect(eco.basis).toBe('economic')
    expect(eco.note).toContain('не регламентирует')
  })
})

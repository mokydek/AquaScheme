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

  it('every entry starts unverified until confirmed against the official text', () => {
    expect(unverifiedClauses()).toHaveLength(NORM_REGISTRY.length)
    expect(NORM_REGISTRY.every((c) => c.status === 'unverified')).toBe(true)
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

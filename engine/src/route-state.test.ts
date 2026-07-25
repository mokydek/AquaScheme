import { describe, expect, it } from 'vitest'
import { resolveRouteFreshness } from './route-state'

describe('route calculation freshness', () => {
  it('keeps a calculation current only for matching algorithm and inputs', () => {
    expect(resolveRouteFreshness({
      storedStatus: 'calculated',
      storedAlgorithmVersion: '2',
      currentAlgorithmVersion: '2',
      storedInputHash: 'abc',
      currentInputHash: 'abc',
    })).toEqual({ status: 'calculated', stale: false, reasons: [] })
  })

  it('invalidates results after an algorithm upgrade', () => {
    expect(resolveRouteFreshness({
      storedStatus: 'calculated',
      storedAlgorithmVersion: '1',
      currentAlgorithmVersion: '2',
      storedInputHash: 'abc',
      currentInputHash: 'abc',
    })).toMatchObject({ status: 'stale', stale: true, reasons: ['algorithm_changed'] })
  })

  it('invalidates results when the input hash changes', () => {
    expect(resolveRouteFreshness({
      storedStatus: 'calculated',
      storedAlgorithmVersion: '2',
      currentAlgorithmVersion: '2',
      storedInputHash: 'abc',
      currentInputHash: 'def',
    })).toMatchObject({ status: 'stale', stale: true, reasons: ['inputs_changed'] })
  })
})

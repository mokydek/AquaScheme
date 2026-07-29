import { describe, expect, it } from 'vitest'
import { normalizeLeafletLayerInputs } from './leafletLayerInputs'

describe('normalizeLeafletLayerInputs', () => {
  it('adds unique ids, stable names and matching label targets to Leaflet-generated controls', () => {
    const labelTargets = ['', '', '', '']
    const inputs = ['radio', 'radio', 'checkbox', 'checkbox'].map((type, index) => ({
      type,
      id: '',
      name: '',
      closest: () => ({
        setAttribute: (name: string, value: string) => {
          if (name === 'for') labelTargets[index] = value
        },
      }),
    }))
    const container = {
      querySelectorAll: () => inputs,
    } as unknown as ParentNode

    expect(normalizeLeafletLayerInputs(container, 'map-:r7:')).toBe(4)
    expect(inputs.map(({ id }) => id)).toEqual([
      'map--r7--base-1',
      'map--r7--base-2',
      'map--r7--overlay-1',
      'map--r7--overlay-2',
    ])
    expect(inputs.map(({ name }) => name)).toEqual([
      'map--r7--base-layer',
      'map--r7--base-layer',
      'map--r7--overlay-1',
      'map--r7--overlay-2',
    ])
    expect(labelTargets).toEqual(inputs.map(({ id }) => id))
    expect(new Set(inputs.map(({ id }) => id)).size).toBe(inputs.length)
  })
})

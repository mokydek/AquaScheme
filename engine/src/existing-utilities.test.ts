import { describe, expect, it } from 'vitest'
import type { DxfNetworkData } from './dxfread'
import { extractExistingUtilities } from './existing-utilities'

function survey(texts: Array<[number, number, string, string?]>): DxfNetworkData {
  return {
    ok: true,
    points: [],
    layers: [{ name: 'NAD_MКАНАЛИЗ', segments: 0, points: 0 }],
    segments: [],
    textEntities: texts.map(([x, y, text, layer]) => ({ x, y, text, layer: layer ?? 'NAD_MКАНАЛИЗ' })),
  }
}

describe('existing utilities recovered from survey annotation', () => {
  it('pairs rim and invert labels into chambers with a depth', () => {
    const result = extractExistingUtilities(survey([
      [-224.15, 8115.31, '685.21'],
      [-224.22, 8113.91, '682.30'],
      [-88.12, 8065.71, '685.86'],
      [-88.28, 8064.42, '682.06'],
    ]))
    expect(result.manholes).toHaveLength(2)
    expect(result.manholes[0].rimElevationM).toBe(685.21)
    expect(result.manholes[0].invertElevationM).toBe(682.30)
    expect(result.manholes[0].depthM).toBeCloseTo(2.91, 2)
  })

  it('reads material and bore from the run caption', () => {
    const result = extractExistingUtilities(survey([
      [-220.54, 8101.68, 'кер.300'],
      [-39.78, 8054.78, 'кер.150'],
      [-6.23, 8016.35, 'чуг 200'],
      [0, 8000, 'пэ.160'],
      [5, 8000, 'а/ц 150'],
    ]))
    expect(result.pipeLabels.map((label) => [label.material, label.diameterMm])).toEqual([
      ['керамика', 300], ['керамика', 150], ['чугун', 200],
      ['полиэтилен', 160], ['асбестоцемент', 150],
    ])
  })

  it('does not read two unrelated spot heights as a chamber', () => {
    // Same elevation twice: no depth, so no chamber.
    const flat = extractExistingUtilities(survey([[0, 0, '686.10'], [1, 0, '686.10']]))
    expect(flat.manholes).toHaveLength(0)
    // Far apart: different chambers, not a pair.
    const distant = extractExistingUtilities(survey([[0, 0, '686.10'], [40, 0, '682.10']]))
    expect(distant.manholes).toHaveLength(0)
    // Implausibly deep for a gravity manhole caption.
    const deep = extractExistingUtilities(survey([[0, 0, '686.10'], [1, 0, '650.10']]))
    expect(deep.manholes).toHaveLength(0)
  })

  it('orders the chain along the flow, starting at the highest invert', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '687.00'],
      [50, 0, '689.00'], [50, 1, '686.00'],
      [100, 0, '688.00'], [100, 1, '685.00'],
    ]))
    expect(result.chain.map((m) => m.invertElevationM)).toEqual([687, 686, 685])
    expect(result.chainLengthM).toBeCloseTo(100, 0)
  })

  it('breaks the run at an implausible jump instead of stitching branches', () => {
    // Three chambers 40 m apart, then one 400 m away: a different branch.
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '687.00'],
      [40, 0, '689.00'], [40, 1, '686.50'],
      [80, 0, '688.00'], [80, 1, '686.00'],
      [480, 0, '687.00'], [480, 1, '685.00'],
    ]))
    expect(result.manholes).toHaveLength(4)
    expect(result.chain).toHaveLength(3)
    expect(result.detachedCount).toBe(1)
    expect(result.maxStepM).toBeLessThan(100)
    expect(result.reason).toContain('вне цепочки')
  })

  it('ignores annotation of other utilities', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '685.00', 'NAD_MТЕПЛОТР'],
      [0, 1, '682.00', 'NAD_MТЕПЛОТР'],
      [10, 0, 'кер.300', 'NAD_MВОДОПРО'],
    ]))
    expect(result.manholes).toHaveLength(0)
    expect(result.pipeLabels).toHaveLength(0)
    expect(result.reason).toContain('не найдены')
  })
})

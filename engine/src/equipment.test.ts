import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { burialDepthM, placeFittings, selectMaterials } from './equipment'
import { traceNetwork } from './trace'
import type { NetworkNode, TracedNetwork } from './trace'

const GEOLOGY = {
  soilType: 'loam' as const,
  groundwaterDepthM: 4,
  corrosivity: 'medium' as const,
  freezingDepthM: 2.2,
}

const SEISMIC = { siteIntensityPoints: 7, subsidenceProne: false, floodProne: false }

describe('selectMaterials', () => {
  it('selects PE100 SDR17 PN10 for normal pressure', () => {
    const selection = selectMaterials({ geology: GEOLOGY, seismicity: SEISMIC, maxPressureM: 45 })
    expect(selection.primary).toBe('PE100_SDR17')
    expect(selection.pnBar).toBe(10)
    expect(selection.jointType).toBe('welded')
  })

  it('steps up to SDR11 PN16 when pressure needs the margin', () => {
    const selection = selectMaterials({ geology: GEOLOGY, seismicity: SEISMIC, maxPressureM: 85 })
    expect(selection.primary).toBe('PE100_SDR11')
    expect(selection.pnBar).toBe(16)
  })

  it('flags corrosion protection for aggressive soils or high groundwater', () => {
    const selection = selectMaterials({
      geology: { ...GEOLOGY, corrosivity: 'high', groundwaterDepthM: 1.5 },
      seismicity: { ...SEISMIC, siteIntensityPoints: 6 },
      maxPressureM: 40,
    })
    expect(selection.reasons).toContain('corrosionProtection')
    expect(selection.needsCompensators).toBe(false)
  })

  it('requires compensators from 7 seismic points', () => {
    const selection = selectMaterials({ geology: GEOLOGY, seismicity: SEISMIC, maxPressureM: 40 })
    expect(selection.reasons).toContain('seismicJoints')
    expect(selection.needsCompensators).toBe(true)
  })

  it('computes the burial depth 0.5 m below freezing', () => {
    expect(burialDepthM(2.2)).toBe(2.7)
    const selection = selectMaterials({ geology: GEOLOGY, seismicity: SEISMIC, maxPressureM: 40 })
    expect(selection.burialDepthM).toBe(2.7)
  })
})

describe('placeFittings on the demo network', () => {
  const demo = createDemoDataset()
  const network = traceNetwork(
    demo.buildings.map((b, i) => ({ id: `bld-${i}`, x: b.x, y: b.y })),
    demo.source,
    demo.surveyPoints,
  )
  const plan = placeFittings(network)
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

  it('keeps hydrant spacing along the ring within 150 m', () => {
    const ringNodes = network.nodes
      .filter((n) => n.kind === 'ring')
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    const hydrantIds = new Set(
      plan.items.filter((i) => i.types.includes('hydrant')).map((i) => i.nodeId),
    )
    const path = [...ringNodes, ringNodes[0]]
    let sinceLast: number | null = hydrantIds.has(path[0].id) ? 0 : null
    for (let i = 1; i < path.length; i++) {
      const segment = Math.hypot(
        path[i].x - path[i - 1].x,
        path[i].y - path[i - 1].y,
      )
      if (sinceLast !== null) {
        sinceLast += segment
        if (hydrantIds.has(path[i].id)) {
          expect(sinceLast).toBeLessThanOrEqual(150.001)
          sinceLast = 0
        }
      } else if (hydrantIds.has(path[i].id)) {
        sinceLast = 0
      }
    }
    expect(plan.counts.hydrants).toBeGreaterThanOrEqual(8)
  })

  it('places air valves at local high points and washouts at low points', () => {
    expect(plan.counts.airValves).toBeGreaterThanOrEqual(1)
    expect(plan.counts.washouts).toBeGreaterThanOrEqual(1)
    const ringNodes = network.nodes
      .filter((n) => n.kind === 'ring')
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    const byId = new Map(ringNodes.map((n, i) => [n.id, i]))
    for (const item of plan.items) {
      if (!item.types.includes('airValve')) continue
      const index = byId.get(item.nodeId)
      if (index === undefined) continue
      const n = ringNodes.length
      const node = nodeById.get(item.nodeId) as NetworkNode
      const prev = ringNodes[(index - 1 + n) % n]
      const next = ringNodes[(index + 1) % n]
      expect(node.groundElevation).toBeGreaterThan(prev.groundElevation)
      expect(node.groundElevation).toBeGreaterThan(next.groundElevation)
    }
  })

  it('places sectioning valves including the supply entry and cross ends', () => {
    expect(plan.counts.valves).toBeGreaterThanOrEqual(3)
    const valveIds = new Set(
      plan.items.filter((i) => i.types.includes('valve')).map((i) => i.nodeId),
    )
    expect(valveIds.has('R1')).toBe(true)
  })

  it('numbers a well at every equipped node', () => {
    expect(plan.counts.wells).toBe(plan.items.length)
    expect(plan.wells[0].label).toBe('ВК-1')
    const labels = new Set(plan.wells.map((w) => w.label))
    expect(labels.size).toBe(plan.wells.length)
  })

  it('is deterministic', () => {
    expect(placeFittings(network)).toEqual(plan)
  })

  it('handles a network without a ring', () => {
    const tiny: TracedNetwork = traceNetwork(
      [
        { id: 'a', x: 10, y: 10 },
        { id: 'b', x: 50, y: 50 },
      ],
      { x: 0, y: 0 },
      [],
    )
    const tinyPlan = placeFittings(tiny)
    expect(tinyPlan.counts.wells).toBe(0)
  })
})

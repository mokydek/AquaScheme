import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { minFreeHeadForFloors } from './norms'
import { traceNetwork } from './trace'
import { ECONOMIC_V_MAX, isSizingResultAcceptable, MIN_MAIN_NOMINAL_MM, sizeNetwork } from './sizing'
import type { TracedNetwork } from './trace'

function demoInput() {
  const demo = createDemoDataset()
  const buildings = demo.buildings.map((b, i) => ({
    id: `bld-${i}`,
    x: b.x,
    y: b.y,
    floors: b.floors,
    residents: b.residents,
  }))
  const network = traceNetwork(
    buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
    demo.source,
    demo.surveyPoints,
  )
  return { demo, buildings, network }
}

describe('sizeNetwork on the demo district', () => {
  it(
    'converges with every building at or above its required free head',
    async () => {
      const { demo, buildings, network } = demoInput()
      const result = await sizeNetwork({
        network,
        buildings: buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
        availableHeadM: demo.source.availableHead,
      })

      expect(result.converged).toBe(true)
      expect(result.issues.filter((i) => i.kind === 'lowPressure')).toHaveLength(0)

      const buildingNodes = result.nodes.filter((n) => n.buildingId)
      expect(buildingNodes).toHaveLength(40)
      const floorsById = new Map(buildings.map((b) => [b.id, b.floors]))
      for (const node of buildingNodes) {
        const required = minFreeHeadForFloors(floorsById.get(node.buildingId as string) ?? 1)
        expect(node.pressureM).toBeGreaterThanOrEqual(required - 0.01)
      }
    },
    60000,
  )

  it(
    'keeps velocities economic and mains at or above the fire minimum',
    async () => {
      const { demo, buildings, network } = demoInput()
      const result = await sizeNetwork({
        network,
        buildings: buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
        availableHeadM: demo.source.availableHead,
      })

      for (const pipe of result.pipes) {
        expect(pipe.velocityMs).toBeLessThanOrEqual(ECONOMIC_V_MAX + 0.001)
        if (pipe.kind !== 'service') {
          expect(pipe.nominalMm).toBeGreaterThanOrEqual(MIN_MAIN_NOMINAL_MM)
        }
      }
      expect(result.totalDemandLps).toBeGreaterThan(10)
      expect(result.totalDemandLps).toBeLessThan(15)
    },
    60000,
  )

  it(
    'reports low pressure issues when the source head is insufficient',
    async () => {
      const { buildings, network } = demoInput()
      const result = await sizeNetwork({
        network,
        buildings: buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
        availableHeadM: 12,
      })

      expect(result.converged).toBe(false)
      expect(result.issues.some((i) => i.kind === 'lowPressure')).toBe(true)
      expect(result.solves).toBeLessThan(10)
    },
    60000,
  )

  it('blocks a negative-pressure transit junction even without a building id', async () => {
    const network: TracedNetwork = {
      nodes: [
        { id: 'SRC', kind: 'source', x: 0, y: 0, groundElevation: 0 },
        { id: 'HIGH', kind: 'junction', x: 100, y: 0, groundElevation: 20 },
        { id: 'B1', kind: 'building', x: 200, y: 0, groundElevation: 20, buildingId: 'building-1' },
      ],
      pipes: [
        { id: 'P1', kind: 'main', fromNode: 'SRC', toNode: 'HIGH', lengthM: 100 },
        { id: 'P2', kind: 'service', fromNode: 'HIGH', toNode: 'B1', lengthM: 100 },
      ],
      totalLengthM: 200,
    }

    const result = await sizeNetwork({
      network,
      buildings: [{ id: 'building-1', floors: 1, residents: 1 }],
      availableHeadM: 10,
    })

    const transit = result.nodes.find((node) => node.id === 'HIGH')!
    expect(transit.pressureM).toBeLessThan(0)
    expect(transit.requiredPressureM).toBe(0)
    expect(transit.ok).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'lowPressure', targetId: 'HIGH' }))
    expect(result.converged).toBe(false)
    expect(isSizingResultAcceptable(result)).toBe(false)
    expect(result.solves).toBe(1)
    expect(result.solverWarnings).toEqual([
      expect.objectContaining({ code: 6, presentInFinalSolve: true, occurrences: 1 }),
    ])

    // A legacy run cannot bypass the export gate merely by carrying a stale
    // converged=true flag from before transit-node validation existed.
    const staleLegacyFlag = {
      ...result,
      converged: true,
      issues: [],
      nodes: result.nodes.map((node) => node.id === 'HIGH' ? { ...node, ok: true } : node),
    }
    expect(isSizingResultAcceptable(staleLegacyFlag)).toBe(false)
  })
})

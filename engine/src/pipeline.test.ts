import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { computeNetworkDemand } from './demand'
import { placeFittings, selectMaterials } from './equipment'
import { minFreeHeadForFloors, NORMATIVE_DEFAULTS } from './norms'
import { buildRecommendations } from './recommendations'
import { sizeNetwork } from './sizing'
import { traceNetwork } from './trace'
import { buildNetworkDxf } from './dxf'
import { buildSpecification } from './specification'
import { buildNoteDoc } from './note'
import type { ExportInput } from './exportdata'

/**
 * End to end MVP acceptance: the whole pipeline on the built in demo district,
 * from survey to deliverables, asserting the guarantees the product promises.
 */
describe('full pipeline on the demo district (surveys -> deliverables)', () => {
  it(
    'routes, sizes, equips and produces a coherent deliverable set',
    async () => {
      const demo = createDemoDataset()
      const buildings = demo.buildings.map((b, i) => ({
        id: `bld-${i}`,
        label: b.label,
        x: b.x,
        y: b.y,
        floors: b.floors,
        residents: b.residents,
      }))

      // Routing: looped network reaching every building.
      const network = traceNetwork(
        buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
        demo.source,
        demo.surveyPoints,
      )
      expect(network.pipes.some((p) => p.kind === 'ring')).toBe(true)
      expect(network.pipes.filter((p) => p.kind === 'service')).toHaveLength(40)

      // Demand and sizing.
      const demand = computeNetworkDemand(buildings.map((b) => ({ id: b.id, residents: b.residents })))
      const sizing = await sizeNetwork({
        network,
        buildings: buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
        availableHeadM: demo.source.availableHead,
      })

      // Guarantee: every building has at least its required free head.
      expect(sizing.converged).toBe(true)
      const floorsById = new Map(buildings.map((b) => [b.id, b.floors]))
      const buildingNodes = sizing.nodes.filter((n) => n.buildingId)
      expect(buildingNodes).toHaveLength(40)
      for (const node of buildingNodes) {
        const required = minFreeHeadForFloors(floorsById.get(node.buildingId as string) ?? 1)
        expect(node.pressureM).toBeGreaterThanOrEqual(required - 0.01)
      }
      // A converged run yields no blocking recommendations.
      expect(buildRecommendations(sizing).some((r) => r.severity === 'high')).toBe(false)

      // Equipment.
      const maxPressure = Math.max(
        ...sizing.nodes.filter((n) => n.kind !== 'source').map((n) => n.pressureM),
      )
      const material = selectMaterials({
        geology: demo.geology,
        seismicity: demo.seismicity,
        maxPressureM: maxPressure,
      })
      const fittings = placeFittings(network)
      expect(material.burialDepthM).toBeGreaterThan(demo.geology.freezingDepthM)
      expect(fittings.counts.hydrants).toBeGreaterThan(0)
      expect(fittings.counts.wells).toBe(fittings.items.length)

      // Deliverables.
      const input: ExportInput = {
        projectName: 'Демо микрорайон',
        dateIso: '2026-07-11',
        source: {
          x: demo.source.x,
          y: demo.source.y,
          groundElevation: demo.source.groundElevation,
          availableHead: demo.source.availableHead,
        },
        buildings,
        network,
        sizing,
        demand,
        material,
        fittings,
        norms: NORMATIVE_DEFAULTS,
        geology: demo.geology,
        seismicity: demo.seismicity,
        surveyPoints: demo.surveyPoints,
      }

      const dxf = buildNetworkDxf(input)
      expect(dxf).toContain('В1-сеть')
      expect(dxf.trimEnd().endsWith('EOF')).toBe(true)

      const spec = buildSpecification(input)
      expect(spec.filter((i) => i.name.includes('Труба')).length).toBeGreaterThan(0)
      expect(spec.find((i) => i.name.includes('Колодец'))?.quantity).toBe(fittings.counts.wells)

      const note = buildNoteDoc(input)
      expect(JSON.stringify(note)).toContain('Проверка свободных напоров')
    },
    60000,
  )
})

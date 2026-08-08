import { describe, expect, it } from 'vitest'
import { SOLVER_AVAILABILITY } from './systems'
import { solveGravityNetwork } from './norms/gravity'
import { waterPressureSolver } from './hydraulics'
import type { TracedNetwork } from './trace'

describe('solver architecture (requirements update 1)', () => {
  it('declares availability per system', () => {
    expect(SOLVER_AVAILABILITY.water).toBe('ready')
    // К1/К2 gravity solvers implemented in phase НБ4.
    expect(SOLVER_AVAILABILITY.sewer).toBe('ready')
    expect(SOLVER_AVAILABILITY.storm).toBe('ready')
  })

  /**
   * Самотёк проверяется на том входе, которым пользуется приложение.
   *
   * Раньше здесь стоял адаптер `createGravitySolver`, но его результат беднее:
   * замечания труб в него не проходили. Тест проверяет и то, ради чего адаптер
   * убран, — что полный вход эти замечания отдаёт.
   */
  it('the gravity design runs by Chezy-Manning and keeps its issues (НБ4)', () => {
    const network: TracedNetwork = {
      nodes: [
        { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
        { id: 'B1', kind: 'building', x: 30, y: 0, groundElevation: 101, buildingId: 'b1' },
      ],
      pipes: [{ id: 'p1', kind: 'main', fromNode: 'S', toNode: 'B1', lengthM: 30 }],
      totalLengthM: 30,
    }
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: new Map([['b1', 8]]),
      system: 'sewer',
    })
    expect(result.kind).toBe('gravity')
    expect(result.systemType).toBe('sewer')
    expect(result.pipes[0].diameterMm).toBeGreaterThanOrEqual(200)
    expect(result.pipes[0].fillRatio).toBeLessThanOrEqual(0.8)
    expect(result.outletFlowLps).toBeCloseTo(8, 6)
    // Признак непригодности, терявшийся в адаптере.
    expect(Array.isArray(result.pipes[0].issues)).toBe(true)
  })

  it('сеть без расхода честно сообщает об этом, а не выдаёт нулевой проект', () => {
    const network: TracedNetwork = {
      nodes: [
        { id: 'MH-1', kind: 'manhole', x: 0, y: 0, groundElevation: 100 },
        { id: 'OUT', kind: 'outlet', x: 30, y: 0, groundElevation: 99 },
      ],
      pipes: [{ id: 'p1', kind: 'gravity_collector', fromNode: 'MH-1', toNode: 'OUT', lengthM: 30 }],
      totalLengthM: 30,
    }
    const result = solveGravityNetwork({ network, buildingFlowLps: new Map(), system: 'sewer' })
    expect(result.pipes[0].issues.some((issue) => issue.code === 'noDesignFlow')).toBe(true)
  })

  it('the water solver wraps EPANET and returns a pressure result', async () => {
    const result = await waterPressureSolver.solve({
      source: { id: 'SRC', totalHeadM: 100 },
      junctions: [{ id: 'J1', elevationM: 50, demandLps: 10 }],
      pipes: [
        {
          id: 'P1',
          fromNode: 'SRC',
          toNode: 'J1',
          lengthM: 500,
          internalDiameterMm: 100,
          roughnessMm: 0.05,
        },
      ],
    })
    expect(result.kind).toBe('pressure')
    expect(result.systemType).toBe('water')
    const j1 = result.nodes.find((n) => n.id === 'J1')
    expect(j1?.pressureM).toBeCloseTo(41.8, 0)
    expect(result.pipes[0].velocityMs).toBeCloseTo(1.273, 2)
  })
})

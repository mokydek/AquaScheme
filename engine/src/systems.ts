import type { SystemType } from './types'
import type { TracedNetwork } from './trace'
import { solveGravityNetwork } from './norms/gravity'

/**
 * Solver architecture for the three engineering systems (requirements
 * update 1). Water is a pressure network solved by EPANET; sewer (K1) and
 * storm (K2) are gravity networks (Manning: fill ratio h/d, self cleaning
 * velocity, slopes) whose solvers arrive in the deferred K1/K2 phases.
 *
 * This module holds ONLY types and light stubs so it can live in the main
 * engine index without pulling the EPANET WASM into the main bundle. The
 * water implementation of NetworkSolver is exported from ./hydraulics
 * (subpath @aquascheme/engine/hydraulics).
 */

export interface PressureNodeState {
  id: string
  headM: number
  pressureM: number
}

export interface PressurePipeState {
  id: string
  flowLps: number
  velocityMs: number
  headlossM: number
}

/** Result of a pressure network run (water). */
export interface PressureSolveResult {
  kind: 'pressure'
  systemType: SystemType
  nodes: PressureNodeState[]
  pipes: PressurePipeState[]
}

export interface GravityPipeState {
  id: string
  flowLps: number
  diameterMm: number
  /** Fill ratio h/d, 0..1. */
  fillRatio: number
  velocityMs: number
  /** Hydraulic slope, m/m. */
  slope: number
}

/** Result of a gravity network run (sewer K1, storm K2). */
export interface GravitySolveResult {
  kind: 'gravity'
  systemType: SystemType
  pipes: GravityPipeState[]
  outletFlowLps: number
}

export interface GravitySolveInput {
  network: TracedNetwork
  buildingFlowLps: Map<string, number>
  roughness?: number
}

export type SolveResult = PressureSolveResult | GravitySolveResult

/** A network solver bound to one engineering system. */
export interface NetworkSolver<TInput, TResult extends SolveResult> {
  systemType: SystemType
  solve(input: TInput): Promise<TResult>
}

/** Which system solvers are implemented today. */
export const SOLVER_AVAILABILITY: Record<SystemType, 'ready' | 'planned'> = {
  water: 'ready',
  sewer: 'ready',
  storm: 'ready',
}

/**
 * Gravity solver (К1 sewer, К2 storm): free-surface Chezy-Manning design per
 * СН РК 4.01-03-2013*, implemented in ./norms/gravity.
 */
export function createGravitySolver(
  systemType: 'sewer' | 'storm',
): NetworkSolver<GravitySolveInput, GravitySolveResult> {
  return {
    systemType,
    solve(input: GravitySolveInput): Promise<GravitySolveResult> {
      const result = solveGravityNetwork({
        network: input.network,
        buildingFlowLps: input.buildingFlowLps,
        system: systemType,
        roughness: input.roughness,
      })
      return Promise.resolve({
        kind: 'gravity',
        systemType,
        pipes: result.pipes.map((p) => ({
          id: p.id,
          flowLps: p.flowLps,
          diameterMm: p.diameterMm,
          fillRatio: p.fillRatio,
          velocityMs: p.velocityMs,
          slope: p.slope,
        })),
        outletFlowLps: result.outletFlowLps,
      })
    },
  }
}

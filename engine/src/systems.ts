import type { SystemType } from './types'

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
  sewer: 'planned',
  storm: 'planned',
}

/**
 * Gravity solver stub: declared so the architecture is in place from the
 * start; the Manning based implementation lands in phases K1/K2.
 */
export function createGravitySolver(systemType: 'sewer' | 'storm'): NetworkSolver<never, GravitySolveResult> {
  return {
    systemType,
    solve(): Promise<GravitySolveResult> {
      return Promise.reject(
        new Error(`notImplemented: the ${systemType} gravity solver arrives in phase ${systemType === 'sewer' ? 'K1' : 'K2'}`),
      )
    },
  }
}

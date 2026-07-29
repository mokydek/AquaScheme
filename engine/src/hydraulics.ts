import { CountType, LinkProperty, NodeProperty, Project, Workspace } from 'epanet-js'
import type { NetworkSolver, PressureSolveResult } from './systems'

/**
 * Steady state hydraulic solver on top of EPANET (epanet-js, WASM).
 * We do NOT implement our own solver: flow distribution and loop balancing
 * are done by EPANET; head losses use Darcy-Weisbach with the pipe material
 * roughness (SP RK 4.01-101 allows Darcy-Weisbach based calculation).
 *
 * Units: LPS (SI). Elevation/head/pressure in meters, diameter in mm,
 * Darcy-Weisbach roughness in mm, flow in L/s, velocity in m/s.
 */

export interface HydraulicJunction {
  id: string
  elevationM: number
  demandLps: number
}

export interface HydraulicSource {
  id: string
  /** Total hydraulic head: ground elevation plus available head, m. */
  totalHeadM: number
}

export interface HydraulicPipe {
  id: string
  fromNode: string
  toNode: string
  lengthM: number
  internalDiameterMm: number
  roughnessMm: number
}

export interface HydraulicsInput {
  source: HydraulicSource
  junctions: HydraulicJunction[]
  pipes: HydraulicPipe[]
}

export interface NodeResult {
  id: string
  headM: number
  pressureM: number
}

export interface PipeResult {
  id: string
  flowLps: number
  velocityMs: number
  headlossM: number
  unitHeadlossMPerKm: number
}

export interface HydraulicSolverWarning {
  code: number
  message: string
}

export interface HydraulicsResult {
  nodes: Map<string, NodeResult>
  pipes: Map<string, PipeResult>
  /** Structured EPANET diagnostics captured from the current solve. */
  warnings: HydraulicSolverWarning[]
}

/** Build the EPANET INP text for a single period run. */
export function buildInp(input: HydraulicsInput): string {
  const lines: string[] = []
  lines.push('[TITLE]', 'AquaScheme network', '')
  lines.push('[JUNCTIONS]', ';ID  Elev  Demand')
  for (const j of input.junctions) {
    lines.push(` ${j.id}  ${j.elevationM.toFixed(3)}  ${j.demandLps.toFixed(5)}`)
  }
  lines.push('', '[RESERVOIRS]', ';ID  Head')
  lines.push(` ${input.source.id}  ${input.source.totalHeadM.toFixed(3)}`)
  lines.push('', '[PIPES]', ';ID  Node1  Node2  Length  Diameter  Roughness  MinorLoss  Status')
  for (const p of input.pipes) {
    lines.push(
      ` ${p.id}  ${p.fromNode}  ${p.toNode}  ${p.lengthM.toFixed(2)}  ${p.internalDiameterMm.toFixed(1)}  ${p.roughnessMm.toFixed(4)}  0  Open`,
    )
  }
  lines.push('', '[OPTIONS]')
  lines.push(' Units LPS')
  lines.push(' Headloss D-W')
  lines.push(' Trials 200')
  lines.push(' Accuracy 0.0001')
  lines.push('', '[TIMES]', ' Duration 0')
  lines.push('', '[REPORT]', ' Status No', ' Summary No')
  lines.push('', '[END]', '')
  return lines.join('\n')
}

let sharedWorkspace: Workspace | null = null
let loading: Promise<Workspace> | null = null

/** The EPANET WASM module is loaded once and reused between solves. */
async function getWorkspace(): Promise<Workspace> {
  if (sharedWorkspace) return sharedWorkspace
  if (!loading) {
    loading = (async () => {
      const ws = new Workspace()
      await ws.loadModule()
      sharedWorkspace = ws
      return ws
    })()
  }
  return loading
}

/**
 * The water implementation of the NetworkSolver architecture (systems.ts).
 * Lives here, in the heavy subpath, so EPANET WASM stays out of the main
 * bundle; sewer and storm gravity solvers arrive in phases K1/K2.
 */
export const waterPressureSolver: NetworkSolver<HydraulicsInput, PressureSolveResult> = {
  systemType: 'water',
  async solve(input: HydraulicsInput): Promise<PressureSolveResult> {
    const result = await solveHydraulics(input)
    return {
      kind: 'pressure',
      systemType: 'water',
      nodes: [...result.nodes.values()].map((n) => ({
        id: n.id,
        headM: n.headM,
        pressureM: n.pressureM,
      })),
      pipes: [...result.pipes.values()].map((p) => ({
        id: p.id,
        flowLps: p.flowLps,
        velocityMs: p.velocityMs,
        headlossM: p.headlossM,
      })),
    }
  },
}

export async function solveHydraulics(input: HydraulicsInput): Promise<HydraulicsResult> {
  const ws = await getWorkspace()
  const model = new Project(ws)
  ws.writeFile('net.inp', buildInp(input))
  model.open('net.inp', 'net.rpt', 'net.bin')
  try {
    // epanet-js 0.9.0 prints toolkit warning 6 directly to console.warn and
    // does not expose a logger/onWarning API. Capture that one known warning
    // synchronously so sizing can turn it into an engineering diagnostic
    // instead of flooding DevTools once per diameter trial. Other warnings
    // are deliberately forwarded unchanged.
    const warnings: HydraulicSolverWarning[] = []
    const previousWarn = console.warn
    console.warn = (...args: unknown[]) => {
      const first = typeof args[0] === 'string' ? args[0] : ''
      const match = /^epanet-js \(Warning 6\):\s*(.*)$/i.exec(first)
      if (match) {
        warnings.push({ code: 6, message: match[1] || 'System has negative pressures.' })
        return
      }
      previousWarn.apply(console, args)
    }
    try {
      model.solveH()
    } finally {
      console.warn = previousWarn
    }

    const nodes = new Map<string, NodeResult>()
    const nodeCount = model.getCount(CountType.NodeCount)
    for (let i = 1; i <= nodeCount; i++) {
      const id = model.getNodeId(i)
      nodes.set(id, {
        id,
        headM: model.getNodeValue(i, NodeProperty.Head),
        pressureM: model.getNodeValue(i, NodeProperty.Pressure),
      })
    }

    const lengthById = new Map(input.pipes.map((p) => [p.id, p.lengthM]))
    const pipes = new Map<string, PipeResult>()
    const linkCount = model.getCount(CountType.LinkCount)
    for (let i = 1; i <= linkCount; i++) {
      const id = model.getLinkId(i)
      const lengthM = lengthById.get(id) ?? 0
      const headlossM = Math.abs(model.getLinkValue(i, LinkProperty.Headloss))
      pipes.set(id, {
        id,
        flowLps: model.getLinkValue(i, LinkProperty.Flow),
        velocityMs: model.getLinkValue(i, LinkProperty.Velocity),
        headlossM,
        unitHeadlossMPerKm: lengthM > 0 ? (headlossM / lengthM) * 1000 : 0,
      })
    }

    return { nodes, pipes, warnings }
  } finally {
    model.close()
  }
}

import type { TracedNetwork } from '../trace'

/**
 * Step plan for drawing the situational scheme the way a drafter builds it
 * (ситуационная схема, поэтапно): each stage names WHAT is drawn and FROM
 * WHICH project data it comes, so the UI can replay the construction and the
 * user sees the provenance of every layer. Pure derivation from the project
 * model — the steps never claim data that is absent: a missing layer stays in
 * the plan with present=false and an honest "no data" source note.
 */

export type SituationStepId =
  | 'context'
  | 'corridor'
  | 'route'
  | 'diameters'
  | 'outlet'
  | 'legend'

export interface SituationStep {
  id: SituationStepId
  /** 1-based drawing order. */
  order: number
  /** Data exists and the layer will actually appear. */
  present: boolean
  /** i18n suffix describing the data source of this stage. */
  sourceKey: string
  /** Numbers/strings to interpolate into the step description. */
  stats: Record<string, number | string>
}

export interface SituationStepsInput {
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  buildingsCount: number
  /** Corridor rings loaded from the parcels (полоса отвода). */
  corridorRings?: number
  outletFlowLps?: number
  /** Diameters adopted from the master-plan scheme per the design task. */
  diametersAdoptedFromPlan?: boolean
}

export function buildSituationSteps(input: SituationStepsInput): SituationStep[] {
  const totalLengthM = Math.round(
    input.network.pipes.reduce((s, p) => s + p.lengthM, 0),
  )
  const uniqueDiameters = [...new Set([...input.pipeDiameterMm.values()])].sort((a, b) => a - b)
  const hasOutlet = input.network.nodes.some((n) => n.kind === 'source')
  const corridorRings = input.corridorRings ?? 0

  const steps: SituationStep[] = [
    {
      id: 'context',
      order: 1,
      present: input.buildingsCount > 0,
      sourceKey: input.buildingsCount > 0 ? 'context' : 'contextEmpty',
      stats: { count: input.buildingsCount },
    },
    {
      id: 'corridor',
      order: 2,
      present: corridorRings > 0,
      sourceKey: corridorRings > 0 ? 'corridor' : 'corridorEmpty',
      stats: { count: corridorRings },
    },
    {
      id: 'route',
      order: 3,
      present: input.network.pipes.length > 0,
      sourceKey: 'route',
      stats: { pipes: input.network.pipes.length, lengthM: totalLengthM },
    },
    {
      id: 'diameters',
      order: 4,
      present: uniqueDiameters.length > 0,
      sourceKey: input.diametersAdoptedFromPlan ? 'diametersPlan' : 'diametersCalc',
      stats: {
        count: uniqueDiameters.length,
        list: uniqueDiameters.map((d) => `Ø${d}`).join(', '),
      },
    },
    {
      id: 'outlet',
      order: 5,
      present: hasOutlet,
      sourceKey: hasOutlet ? 'outlet' : 'outletEmpty',
      stats: { flowLps: input.outletFlowLps != null ? input.outletFlowLps.toFixed(1) : '—' },
    },
    {
      id: 'legend',
      order: 6,
      present: true,
      sourceKey: 'legend',
      stats: {},
    },
  ]
  return steps
}

/** Step ids visible at playback position `index` (0 = nothing drawn yet). */
export function visibleStepIds(steps: SituationStep[], index: number): Set<SituationStepId> {
  return new Set(steps.slice(0, Math.max(0, Math.min(index, steps.length))).map((s) => s.id))
}

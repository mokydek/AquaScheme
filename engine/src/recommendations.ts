import type { SizingIssue, SizingResult } from './sizing'

/**
 * Turns hydraulic constraint violations into concrete engineering
 * recommendations (SP RK 4.01-101 requires the tool to not stay silent but
 * to point at problem nodes and suggest fixes).
 *
 * A key distinction for low pressure: whether the deficit is STATIC (the
 * source head itself cannot reach the required piezometric level at the
 * node, so a bigger pipe changes nothing and a booster station or zoning is
 * needed) or DYNAMIC (the head is there but losses eat it, so a larger
 * diameter or an extra loop helps).
 */

export type RecommendationAction =
  | 'increaseDiameter'
  | 'addLoop'
  | 'boosterStation'
  | 'pressureRegulator'
  | 'zoning'
  | 'reduceDiameter'

export interface Recommendation {
  kind: SizingIssue['kind']
  severity: 'high' | 'medium'
  /** Engine ids of the affected nodes or pipes. */
  targets: string[]
  /** Recommended actions, most preferred first. */
  actions: RecommendationAction[]
}

export function buildRecommendations(result: SizingResult): Recommendation[] {
  const byKind = new Map<SizingIssue['kind'], SizingIssue[]>()
  for (const issue of result.issues) {
    byKind.set(issue.kind, [...(byKind.get(issue.kind) ?? []), issue])
  }
  const recommendations: Recommendation[] = []

  const lowPressure = byKind.get('lowPressure') ?? []
  if (lowPressure.length > 0) {
    const nodeById = new Map(result.nodes.map((n) => [n.id, n]))
    let staticDeficit = false
    for (const issue of lowPressure) {
      const node = nodeById.get(issue.targetId)
      if (!node || node.requiredPressureM === undefined) continue
      const requiredHead = node.elevationM + node.requiredPressureM
      if (result.sourceHeadM < requiredHead - 0.01) {
        staticDeficit = true
        break
      }
    }
    recommendations.push({
      kind: 'lowPressure',
      severity: 'high',
      targets: lowPressure.map((i) => i.targetId),
      actions: staticDeficit
        ? ['boosterStation', 'zoning', 'increaseDiameter']
        : ['increaseDiameter', 'addLoop', 'boosterStation'],
    })
  }

  const highVelocity = byKind.get('highVelocity') ?? []
  if (highVelocity.length > 0) {
    recommendations.push({
      kind: 'highVelocity',
      severity: 'high',
      targets: highVelocity.map((i) => i.targetId),
      actions: ['increaseDiameter'],
    })
  }

  const highPressure = byKind.get('highPressure') ?? []
  if (highPressure.length > 0) {
    recommendations.push({
      kind: 'highPressure',
      severity: 'medium',
      targets: highPressure.map((i) => i.targetId),
      actions: ['pressureRegulator', 'zoning'],
    })
  }

  const lowVelocity = byKind.get('lowVelocity') ?? []
  if (lowVelocity.length > 0) {
    recommendations.push({
      kind: 'lowVelocity',
      severity: 'medium',
      targets: lowVelocity.map((i) => i.targetId),
      actions: ['reduceDiameter'],
    })
  }

  return recommendations
}

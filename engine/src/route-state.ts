export type PersistedRouteStatus = 'stale' | 'blocked' | 'preliminary' | 'calculated'

export type RouteFreshnessReason =
  | 'missing_calculation'
  | 'algorithm_changed'
  | 'inputs_changed'

export interface RouteFreshness {
  status: PersistedRouteStatus
  stale: boolean
  reasons: RouteFreshnessReason[]
}

/**
 * Resolve whether a persisted route can still be presented as current.
 * Route results are derived data: an engine upgrade or any input hash change
 * invalidates them even when the database row still says "calculated".
 */
export function resolveRouteFreshness(input: {
  storedStatus?: PersistedRouteStatus | null
  storedAlgorithmVersion?: string | null
  currentAlgorithmVersion: string
  storedInputHash?: string | null
  currentInputHash?: string | null
}): RouteFreshness {
  const reasons: RouteFreshnessReason[] = []
  if (!input.storedStatus || !input.storedAlgorithmVersion || !input.storedInputHash) {
    reasons.push('missing_calculation')
  }
  if (input.storedAlgorithmVersion && input.storedAlgorithmVersion !== input.currentAlgorithmVersion) {
    reasons.push('algorithm_changed')
  }
  if (input.currentInputHash && input.storedInputHash && input.currentInputHash !== input.storedInputHash) {
    reasons.push('inputs_changed')
  }
  return {
    status: reasons.length ? 'stale' : (input.storedStatus ?? 'stale'),
    stale: reasons.length > 0 || input.storedStatus === 'stale',
    reasons,
  }
}

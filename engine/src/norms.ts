/**
 * Default normative parameters with sources.
 *
 * References:
 * - Per capita demand: SNiP 2.04.02-84* table 1 (SP RK 4.01-101-2012 uses the
 *   same methodology): 160..230 L/day per resident for dwellings with indoor
 *   plumbing, sewerage and baths. Default 200 is the middle of the range and
 *   must be confirmed by the engineer for the actual level of improvement.
 * - Day max coefficient K_day.max = 1.1..1.3 (SNiP 2.04.02-84* clause 2.2).
 *   Default 1.2.
 * - Fire fighting flow: 15 L/s for settlements between 10 000 and 25 000
 *   residents (SNiP 2.04.02-84* table 5). Default 15, confirm by settlement
 *   size and building storeys.
 * - Minimum free head: 10 m of water column for one storey buildings plus
 *   4 m per each additional storey (SNiP 2.04.02-84* clause 2.26).
 * - Maximum free head: 60 m (SNiP 2.04.02-84* clause 2.28).
 * - Freezing depth is site specific (for the Astana region roughly
 *   2.0..2.4 m); the engineer must set the design value from the survey.
 */

export interface NormativeParams {
  /** Liters per resident per day. */
  perCapitaDemandLpd: number
  /** Daily unevenness coefficient K_day.max. */
  dayMaxCoefficient: number
  /**
   * Alpha max: hourly unevenness factor reflecting the level of building
   * services, 1.2..1.4 (SNiP 2.04.02-84* clause 2.2). K_hour.max = alpha * beta.
   */
  alphaMax: number
  /** Fire fighting design flow, L/s. */
  fireFlowLps: number
  /** Minimum free head for a one storey building, m. */
  minFreeHeadBaseM: number
  /** Additional free head per storey above the first, m. */
  freeHeadPerFloorM: number
  /** Maximum allowed free head, m. */
  maxFreeHeadM: number
}

export const NORMATIVE_DEFAULTS: NormativeParams = {
  perCapitaDemandLpd: 200,
  dayMaxCoefficient: 1.2,
  alphaMax: 1.3,
  fireFlowLps: 15,
  minFreeHeadBaseM: 10,
  freeHeadPerFloorM: 4,
  maxFreeHeadM: 60,
}

/** Default design freezing depth, m. Site specific, engineer must confirm. */
export const DEFAULT_FREEZING_DEPTH_M = 2.0

/**
 * Minimum required free head for a building by storey count.
 * SNiP 2.04.02-84* clause 2.26.
 */
export function minFreeHeadForFloors(floors: number, params: NormativeParams = NORMATIVE_DEFAULTS): number {
  const storeys = Math.max(1, Math.floor(floors))
  return params.minFreeHeadBaseM + params.freeHeadPerFloorM * (storeys - 1)
}

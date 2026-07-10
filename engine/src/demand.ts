import { cubicMetersPerHourToLitersPerSecond } from './units'
import { NORMATIVE_DEFAULTS } from './norms'
import type { NormativeParams } from './norms'

/**
 * Water demand calculation per SP RK 4.01-101-2012 (the methodology matches
 * SNiP 2.04.02-84* clauses 2.1 and 2.2):
 *
 *   Q_day.avg = q * N / 1000                      [m3/day]
 *   Q_day.max = K_day.max * Q_day.avg             [m3/day]
 *   K_hour.max = alpha_max * beta_max(N)
 *   Q_hour.max = K_hour.max * Q_day.max / 24      [m3/h]
 *   q_design = Q_hour.max / 3.6                   [L/s]
 *
 * Node demands for the hydraulic model are distributed between buildings
 * proportionally to their residents.
 */

/**
 * SNiP 2.04.02-84* table 2: beta max versus the number of residents.
 * Linear interpolation between rows; clamped at both ends.
 */
const BETA_MAX_TABLE: ReadonlyArray<readonly [number, number]> = [
  [100, 4.5],
  [150, 4],
  [200, 3.5],
  [300, 3],
  [500, 2.5],
  [750, 2.2],
  [1000, 2],
  [1500, 1.8],
  [2500, 1.6],
  [4000, 1.5],
  [6000, 1.4],
  [10000, 1.3],
  [20000, 1.2],
  [50000, 1.15],
  [100000, 1.1],
  [300000, 1.05],
  [1000000, 1],
]

export function betaMaxForResidents(residents: number): number {
  const first = BETA_MAX_TABLE[0]
  const last = BETA_MAX_TABLE[BETA_MAX_TABLE.length - 1]
  if (residents <= first[0]) return first[1]
  if (residents >= last[0]) return last[1]
  for (let i = 1; i < BETA_MAX_TABLE.length; i++) {
    const [n1, b1] = BETA_MAX_TABLE[i]
    if (residents <= n1) {
      const [n0, b0] = BETA_MAX_TABLE[i - 1]
      return b0 + ((residents - n0) / (n1 - n0)) * (b1 - b0)
    }
  }
  return last[1]
}

export interface DemandBuildingInput {
  id?: string
  residents: number
}

export interface BuildingDemand {
  id?: string
  residents: number
  /** Q_day.avg of the building, m3/day. */
  avgDailyM3: number
  /** Q_day.max of the building, m3/day. */
  maxDailyM3: number
  /** The building's share of the network design flow, L/s. */
  designFlowLps: number
}

export interface NetworkDemand {
  totalResidents: number
  avgDailyM3: number
  maxDailyM3: number
  maxHourlyM3h: number
  /** Design second flow at the max consumption hour, L/s. */
  designFlowLps: number
  fireFlowLps: number
  designFlowWithFireLps: number
  alphaMax: number
  betaMax: number
  kHourMax: number
  buildings: BuildingDemand[]
}

export function computeNetworkDemand(
  buildings: DemandBuildingInput[],
  params: NormativeParams = NORMATIVE_DEFAULTS,
): NetworkDemand {
  const residentsOf = (b: DemandBuildingInput) => Math.max(0, b.residents || 0)
  const totalResidents = buildings.reduce((sum, b) => sum + residentsOf(b), 0)

  const avgDailyM3 = (params.perCapitaDemandLpd * totalResidents) / 1000
  const maxDailyM3 = params.dayMaxCoefficient * avgDailyM3
  const betaMax = betaMaxForResidents(totalResidents)
  const kHourMax = params.alphaMax * betaMax
  const maxHourlyM3h = totalResidents > 0 ? (kHourMax * maxDailyM3) / 24 : 0
  const designFlowLps = cubicMetersPerHourToLitersPerSecond(maxHourlyM3h)

  const perBuilding: BuildingDemand[] = buildings.map((b) => {
    const residents = residentsOf(b)
    const share = totalResidents > 0 ? residents / totalResidents : 0
    const buildingAvg = (params.perCapitaDemandLpd * residents) / 1000
    return {
      id: b.id,
      residents,
      avgDailyM3: buildingAvg,
      maxDailyM3: params.dayMaxCoefficient * buildingAvg,
      designFlowLps: designFlowLps * share,
    }
  })

  return {
    totalResidents,
    avgDailyM3,
    maxDailyM3,
    maxHourlyM3h,
    designFlowLps,
    fireFlowLps: params.fireFlowLps,
    designFlowWithFireLps: designFlowLps + params.fireFlowLps,
    alphaMax: params.alphaMax,
    betaMax,
    kHourMax,
    buildings: perBuilding,
  }
}

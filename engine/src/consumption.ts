import { computeNetworkDemand } from './demand'
import type { DemandBuildingInput, NetworkDemand } from './demand'
import { NORMATIVE_DEFAULTS } from './norms'
import type { NormativeParams } from './norms'

/**
 * Unified consumption module shared by water supply and drainage
 * (requirements update 3, change 4). Specific wastewater discharge is taken
 * equal to the specific water demand WITHOUT the irrigation (polив) allowance
 * — norm registry entry drainage.equalsWater. The domestic demand computed by
 * computeNetworkDemand already excludes irrigation (which is an additional
 * water use, not a sewered one), so the drainage flow equals the domestic
 * design flow. Keeping one module means the drainage side never re-enters the
 * consumption data: it is the single source of truth for both systems (this
 * prepares the future gravity solver K1 without implementing it).
 */

export interface Consumption {
  /** The water supply demand (domestic; fire and irrigation are separate). */
  water: NetworkDemand
  /** Average daily wastewater, m3/day (= domestic average daily demand). */
  drainageDailyM3: number
  /** Design wastewater flow, L/s (= domestic design flow, no fire, no irrigation). */
  drainageFlowLps: number
}

export function computeConsumption(
  buildings: DemandBuildingInput[],
  params: NormativeParams = NORMATIVE_DEFAULTS,
): Consumption {
  const water = computeNetworkDemand(buildings, params)
  return {
    water,
    // Wastewater = domestic demand without irrigation. Fire flow is a water
    // supply reserve, not a discharge, so it is excluded here.
    drainageDailyM3: water.maxDailyM3,
    drainageFlowLps: water.designFlowLps,
  }
}

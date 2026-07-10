/**
 * Flow unit conversions used across the engine.
 * 1 L/s = 3.6 m3/h (exact).
 */

export function litersPerSecondToCubicMetersPerHour(flowLps: number): number {
  return flowLps * 3.6
}

export function cubicMetersPerHourToLitersPerSecond(flowM3h: number): number {
  return flowM3h / 3.6
}

export function cubicMetersPerDayToLitersPerSecond(flowM3d: number): number {
  return (flowM3d * 1000) / 86400
}

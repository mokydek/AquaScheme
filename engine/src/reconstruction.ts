/**
 * Reconstruction and the technical survey act (requirements update 1,
 * change 2). Existing pipes get their ACTUAL equivalent roughness from the
 * survey (material, wear, overgrowth), which drives their head loss, and a
 * per segment decision: keep, rehabilitate or replace.
 *
 * The roughness model below is an engineering estimate flagged for
 * confirmation against the Shevelev tables for old pipes; it is not treated
 * as a final normative value.
 */

export type ExistingMaterial = 'steel' | 'cast_iron' | 'concrete' | 'asbestos' | 'pe' | 'pvc' | 'unknown'

export type PipeDecision = 'keep' | 'rehabilitate' | 'replace'

/** Equivalent absolute roughness, mm: new pipe and fully worn (wear 100%). */
const ROUGHNESS_PROFILE: Record<ExistingMaterial, { fresh: number; worn: number }> = {
  steel: { fresh: 0.1, worn: 2.0 },
  cast_iron: { fresh: 0.3, worn: 2.5 },
  concrete: { fresh: 0.5, worn: 3.0 },
  asbestos: { fresh: 0.6, worn: 3.0 },
  pe: { fresh: 0.02, worn: 0.2 },
  pvc: { fresh: 0.02, worn: 0.2 },
  unknown: { fresh: 0.5, worn: 2.0 },
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Estimated equivalent roughness of an existing pipe, mm. Interpolates
 * between the fresh and worn roughness by wear, then adds an increment for
 * internal overgrowth (incrustation).
 */
export function estimateRoughnessMm(
  material: ExistingMaterial,
  wearPercent: number,
  overgrowthPercent = 0,
): number {
  const profile = ROUGHNESS_PROFILE[material] ?? ROUGHNESS_PROFILE.unknown
  const wear = clamp(wearPercent, 0, 100) / 100
  const overgrowth = clamp(overgrowthPercent, 0, 100) / 100
  const base = profile.fresh + (profile.worn - profile.fresh) * wear
  const withOvergrowth = base * (1 + 0.5 * overgrowth)
  return Math.round(withOvergrowth * 1000) / 1000
}

export interface ExistingSegment {
  id: string
  lengthM: number
  diameterMm?: number
  decision: PipeDecision
}

export interface ActSummary {
  totalLengthM: number
  keepLengthM: number
  rehabilitateLengthM: number
  replaceLengthM: number
  counts: Record<PipeDecision, number>
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Totals of the survey act by per segment decision. */
export function summarizeAct(segments: ExistingSegment[]): ActSummary {
  const summary: ActSummary = {
    totalLengthM: 0,
    keepLengthM: 0,
    rehabilitateLengthM: 0,
    replaceLengthM: 0,
    counts: { keep: 0, rehabilitate: 0, replace: 0 },
  }
  for (const segment of segments) {
    const length = segment.lengthM || 0
    summary.totalLengthM += length
    summary.counts[segment.decision]++
    if (segment.decision === 'keep') summary.keepLengthM += length
    else if (segment.decision === 'rehabilitate') summary.rehabilitateLengthM += length
    else summary.replaceLengthM += length
  }
  summary.totalLengthM = round2(summary.totalLengthM)
  summary.keepLengthM = round2(summary.keepLengthM)
  summary.rehabilitateLengthM = round2(summary.rehabilitateLengthM)
  summary.replaceLengthM = round2(summary.replaceLengthM)
  return summary
}

export type ProjectSystemType = 'water' | 'sewer' | 'storm'

/** EPANET pressure sizing is valid only for the B1/water workflow. */
export function isPressurePipelineSystem(systemType: unknown): systemType is 'water' {
  return systemType === 'water'
}

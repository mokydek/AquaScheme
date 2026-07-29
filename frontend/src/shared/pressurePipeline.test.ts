import { describe, expect, it } from 'vitest'
import { isPressurePipelineSystem } from './pressurePipeline'

describe('pressure pipeline dispatch', () => {
  it('allows only B1/water and rejects both gravity systems', () => {
    expect(isPressurePipelineSystem('water')).toBe(true)
    expect(isPressurePipelineSystem('sewer')).toBe(false)
    expect(isPressurePipelineSystem('storm')).toBe(false)
    expect(isPressurePipelineSystem(null)).toBe(false)
  })
})

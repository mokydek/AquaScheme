import { describe, expect, it } from 'vitest'
import {
  AGSK_SECTIONS,
  agskSectionForFitting,
  agskSectionForGravityPipe,
  agskSectionForPipe,
} from './agsk'
import { NORM_DOCUMENTS } from '../normregistry'

describe('АГСК-3 catalogue material sections', () => {
  it('maps pressure pipe materials to their catalogue section', () => {
    expect(agskSectionForPipe('PE100_SDR17').code).toBe('241-2')
    expect(agskSectionForPipe('PVC').code).toBe('241-2')
    expect(agskSectionForPipe('STEEL').code).toBe('241-1')
    expect(agskSectionForPipe('DUCTILE_IRON').code).toBe('241-5')
  })

  it('maps gravity (sewer) pipes: concrete → 241-7, polymer → 241-2', () => {
    expect(agskSectionForGravityPipe('concrete').code).toBe('241-7')
    expect(agskSectionForGravityPipe('polymer').code).toBe('241-2')
  })

  it('maps fittings to their catalogue sections', () => {
    expect(agskSectionForFitting('hydrant').code).toBe('244-4')
    expect(agskSectionForFitting('valve').code).toBe('242-1')
    expect(agskSectionForFitting('airValve').code).toBe('242-4')
    expect(agskSectionForFitting('well').code).toBe('244-2')
  })

  it('section titles are transcribed from the catalogue TOC', () => {
    expect(AGSK_SECTIONS.pipesPolymer.title).toContain('полимерные')
    expect(AGSK_SECTIONS.wells.title).toContain('Колодцы')
  })

  it('АГСК-3 is registered as a reference document', () => {
    expect(NORM_DOCUMENTS.some((d) => d.code === 'АГСК-3')).toBe(true)
  })
})
